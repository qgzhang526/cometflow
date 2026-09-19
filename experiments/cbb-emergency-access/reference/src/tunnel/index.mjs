/**
 * tunnel capability：消费一次性令牌建立临时通道，以及回收通道。
 *
 * 实际转发交给「转发器适配器」（tunnel/spec.md），本服务只负责授权判定与生命周期。
 */
import { randomUUID } from 'node:crypto';
import { hashToken } from '../access/index.mjs';

function ok(data) {
  return { status: 200, code: 0, message: '', data };
}

function err(status, code, message) {
  return { status, code, message, data: {} };
}

export function publicSession(session) {
  if (session === null) return null;
  return {
    session_id: session.session_id,
    grant_id: session.grant_id,
    server_id: session.server_id,
    source_ip: session.source_ip,
    started_at: session.started_at,
    last_active_at: session.last_active_at,
    ended_at: session.ended_at,
    end_reason: session.end_reason,
    status: session.status,
  };
}

export function createTunnelService({ config, store, forwarder, audit }) {
  return {
    open(ctx, body) {
      const token = ctx.token;
      if (typeof token !== 'string' || token === '') {
        return err(401, 'E_AUTH_REQUIRED', '缺少一次性令牌（X-Operator-Token）');
      }
      const grant = store.getGrantByTokenHash(hashToken(token));
      if (grant === null) return err(404, 'E_GRANT_NOT_FOUND', '授权不存在');
      if (grant.status === 'consumed') return err(409, 'E_GRANT_ALREADY_USED', '一次性令牌已被消费');
      if (grant.status === 'revoked') return err(403, 'E_GRANT_REVOKED', '授权已被吊销');
      if (grant.status === 'expired' || Date.parse(grant.expires_at) < ctx.now.getTime()) {
        return err(403, 'E_GRANT_EXPIRED', '授权已过期');
      }

      const request = store.getRequest(grant.request_id);
      if (request === null || request.status !== 'approved') {
        return err(403, 'E_FORBIDDEN_ROLE', '不存在已审批且未过期的申请单');
      }

      const serverId = body?.server_id ?? request.server_id;
      const target = store.getTarget(serverId);
      if (target === null) return err(404, 'E_SERVER_NOT_FOUND', '目标服务器未登记：' + String(serverId));
      if (target.status !== 'online') return err(403, 'E_SERVER_OFFLINE', '目标服务器不可达：' + target.status);

      const session = {
        session_id: 'sess-' + randomUUID(),
        grant_id: grant.grant_id,
        server_id: serverId,
        source_ip: ctx.sourceIp,
        started_at: ctx.now.toISOString(),
        last_active_at: ctx.now.toISOString(),
        ended_at: null,
        end_reason: null,
        status: 'active',
      };

      let rule;
      try {
        rule = forwarder.open({ session_id: session.session_id, server_id: serverId, source_ip: ctx.sourceIp });
      } catch (error) {
        return err(500, 'E_CHANNEL_SETUP_FAILED', '转发规则建立失败：' + error.message);
      }

      store.updateGrant(grant.grant_id, { used: true, status: 'consumed' });
      store.insertSession(session);
      audit.append(ctx, {
        event_type: 'session_started',
        server_id: serverId,
        request_id: request.request_id,
        session_id: session.session_id,
        detail: { grant_id: grant.grant_id, forward_rule: rule?.rule_id ?? null },
      });
      audit.append(ctx, {
        event_type: 'channel_opened',
        server_id: serverId,
        request_id: request.request_id,
        session_id: session.session_id,
        detail: { source_ip: ctx.sourceIp, listen_port: config.tunnel?.listen_port ?? 22022 },
      });
      return ok(publicSession(session));
    },

    close(ctx, body) {
      const sessionId = body?.session_id;
      const session = typeof sessionId === 'string' ? store.getSession(sessionId) : null;
      if (session === null) return err(404, 'E_SESSION_NOT_FOUND', '会话不存在：' + String(sessionId));
      // 幂等：已回收的会话原样返回，不产生任何变更（也不重复写审计）。
      if (session.status === 'ended') return ok(publicSession(session));

      try {
        forwarder.close({ session_id: session.session_id });
      } catch (error) {
        return err(500, 'E_CHANNEL_TEARDOWN_FAILED', '转发规则回收失败：' + error.message);
      }

      const endedAt = ctx.now.toISOString();
      const endReason = typeof body?.reason === 'string' && body.reason !== '' ? body.reason : 'user_closed';
      store.updateSession(session.session_id, { status: 'ended', ended_at: endedAt, end_reason: endReason });
      audit.append(ctx, {
        event_type: 'channel_closed',
        server_id: session.server_id,
        session_id: session.session_id,
        detail: { end_reason: endReason },
      });
      audit.append(ctx, {
        event_type: 'session_ended',
        server_id: session.server_id,
        session_id: session.session_id,
        detail: { end_reason: endReason },
      });
      return ok(publicSession(store.getSession(session.session_id)));
    },
  };
}
