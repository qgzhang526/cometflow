/**
 * access capability：申请 / 审批 / 吊销 / 状态查询。
 *
 * 服务方法返回「响应描述」（status + code + data），由 src/server.mjs 统一包成
 * protocol.md 约定的包络；这样模块层不依赖 HTTP，判据也能直接调。
 */
import { createHash, randomUUID } from 'node:crypto';

function ok(data) {
  return { status: 200, code: 0, message: '', data };
}

function accepted(data) {
  return { status: 202, code: 0, message: '', data };
}

function err(status, code, message) {
  return { status, code, message, data: {} };
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function publicGrant(grant) {
  if (grant === null) return null;
  return {
    grant_id: grant.grant_id,
    request_id: grant.request_id,
    issued_at: grant.issued_at,
    expires_at: grant.expires_at,
    used: grant.used === 1,
    status: grant.status,
  };
}

function publicRequest(request) {
  if (request === null) return null;
  return {
    request_id: request.request_id,
    server_id: request.server_id,
    requester: request.requester,
    reason: request.reason,
    duration_minutes: request.duration_minutes,
    status: request.status,
    created_at: request.created_at,
    expires_at: request.expires_at,
    decided_at: request.decided_at,
    revoked_at: request.revoked_at,
  };
}

export function createAccessService({ config, store, audit }) {
  const access = config.access ?? {};
  const maxDuration = access.max_duration_minutes ?? 30;
  const rejectLimit = access.reject_limit_per_hour ?? 3;
  const circuitBreakMinutes = access.circuit_break_minutes ?? 30;

  return {
    request(ctx, body) {
      const serverId = body?.server_id;
      const target = typeof serverId === 'string' ? store.getTarget(serverId) : null;
      if (target === null) return err(404, 'E_SERVER_NOT_FOUND', '目标服务器未登记：' + String(serverId));

      const duration = body?.duration_minutes;
      if (!Number.isInteger(duration) || duration <= 0) {
        return err(403, 'E_DURATION_EXCEEDS_LIMIT', 'duration_minutes 必须是正整数');
      }
      if (duration > maxDuration) {
        return err(403, 'E_DURATION_EXCEEDS_LIMIT', '申请时长超过上限 ' + maxDuration + ' 分钟');
      }

      const since = new Date(ctx.now.getTime() - 60 * 60_000).toISOString();
      if (store.countRejectionsSince(serverId, since) >= rejectLimit) {
        const until = new Date(ctx.now.getTime() + circuitBreakMinutes * 60_000).toISOString();
        return err(429, 'E_RATE_LIMITED', '该服务器已进入熔断期，最早 ' + until + ' 后可再次申请');
      }

      const request = {
        request_id: 'req-' + randomUUID(),
        server_id: serverId,
        requester: ctx.actor,
        reason: String(body?.reason ?? ''),
        duration_minutes: duration,
        status: 'pending',
        created_at: ctx.now.toISOString(),
        expires_at: new Date(ctx.now.getTime() + duration * 60_000).toISOString(),
        request_trace: ctx.requestId,
      };
      store.insertRequest(request);
      audit.append(ctx, {
        event_type: 'request_created',
        server_id: serverId,
        request_id: request.request_id,
        detail: { duration_minutes: duration, request_trace: ctx.requestId, reason: request.reason },
      });
      return ok(publicRequest(request));
    },

    approve(ctx, body) {
      const requestId = body?.request_id;
      const request = typeof requestId === 'string' ? store.getRequest(requestId) : null;
      if (request === null) return err(404, 'E_REQUEST_NOT_FOUND', '申请单不存在：' + String(requestId));
      if (request.status !== 'pending') {
        return err(409, 'E_REQUEST_ALREADY_DECIDED', '申请单已处于 ' + request.status + ' 状态');
      }

      const decision = body?.decision === 'reject' ? 'reject' : 'approve';
      if (decision === 'reject') {
        store.insertDecision({
          request_id: request.request_id,
          approver: ctx.actor,
          decision,
          comment: body?.comment,
          decided_at: ctx.now.toISOString(),
        });
        store.updateRequest(request.request_id, { status: 'rejected', decided_at: ctx.now.toISOString() });
        audit.append(ctx, {
          event_type: 'request_rejected',
          server_id: request.server_id,
          request_id: request.request_id,
          detail: { comment: body?.comment ?? null },
        });
        return ok({ request_id: request.request_id, status: 'rejected', grant: null });
      }

      if (ctx.actor === request.requester) {
        return err(403, 'E_SELF_APPROVAL', '申请人不能审批自己的申请');
      }

      store.insertDecision({
        request_id: request.request_id,
        approver: ctx.actor,
        decision,
        comment: body?.comment,
        decided_at: ctx.now.toISOString(),
      });

      const approvals = store.listApprovals(request.request_id).filter((item) => item.decision === 'approve');
      const distinctApprovers = new Set(approvals.map((item) => item.approver));
      if ((access.require_second_approver ?? false) && distinctApprovers.size < 2) {
        return accepted({ request_id: request.request_id, status: 'pending', grant: null });
      }

      const token = 'tok-' + randomUUID().replaceAll('-', '');
      const grant = {
        grant_id: 'grant-' + randomUUID(),
        request_id: request.request_id,
        token_hash: hashToken(token),
        issued_at: ctx.now.toISOString(),
        expires_at: new Date(ctx.now.getTime() + request.duration_minutes * 60_000).toISOString(),
        used: false,
        status: 'issued',
      };
      store.insertGrant(grant);
      store.updateRequest(request.request_id, { status: 'approved', decided_at: ctx.now.toISOString() });
      audit.append(ctx, {
        event_type: 'request_approved',
        server_id: request.server_id,
        request_id: request.request_id,
        detail: { approvers: [...distinctApprovers] },
      });
      audit.append(ctx, {
        event_type: 'grant_issued',
        server_id: request.server_id,
        request_id: request.request_id,
        detail: { grant_id: grant.grant_id, expires_at: grant.expires_at },
      });
      return ok({
        request_id: request.request_id,
        status: 'approved',
        grant: { grant_id: grant.grant_id, token, expires_at: grant.expires_at, status: grant.status },
      });
    },

    revoke(ctx, body) {
      const requestId = body?.request_id;
      const request = typeof requestId === 'string' ? store.getRequest(requestId) : null;
      if (request === null) return err(404, 'E_REQUEST_NOT_FOUND', '申请单不存在：' + String(requestId));

      store.updateRequest(request.request_id, { status: 'revoked', revoked_at: ctx.now.toISOString() });
      for (const grant of store.listGrantsByRequest(request.request_id)) {
        store.updateGrant(grant.grant_id, { status: 'revoked' });
      }
      const grant = store.getGrantByRequest(request.request_id);
      audit.append(ctx, {
        event_type: 'request_revoked',
        server_id: request.server_id,
        request_id: request.request_id,
        detail: { previous_status: request.status },
      });
      return ok({
        request_id: request.request_id,
        status: 'revoked',
        grant: grant === null ? null : { grant_id: grant.grant_id, status: grant.status },
      });
    },

    status(ctx, query) {
      const requestId = query.get('request_id');
      const request = typeof requestId === 'string' ? store.getRequest(requestId) : null;
      if (request === null) return err(404, 'E_REQUEST_NOT_FOUND', '申请单不存在：' + String(requestId));
      const grant = store.getGrantByRequest(request.request_id);
      const session = grant === null ? null : store.getSessionByGrant(grant.grant_id);
      return ok({
        request: publicRequest(request),
        grant: publicGrant(grant),
        session:
          session === null
            ? null
            : {
                session_id: session.session_id,
                grant_id: session.grant_id,
                server_id: session.server_id,
                source_ip: session.source_ip,
                started_at: session.started_at,
                last_active_at: session.last_active_at,
                ended_at: session.ended_at,
                end_reason: session.end_reason,
                status: session.status,
              },
      });
    },
  };
}
