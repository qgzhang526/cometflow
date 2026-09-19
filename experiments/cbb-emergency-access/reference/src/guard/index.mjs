/**
 * guard capability：立即执行一次回收扫描（超时 / 空闲会话 + 过期授权）。
 *
 * 扫描依据持久化状态工作，因此服务重启后仍能完成回收（constraints.md 的高可用约束）；
 * 「当前时刻」可以通过 配置：guard.now 注入，用于验收超时路径。
 */
function ok(data) {
  return { status: 200, code: 0, message: '', data };
}

export function createGuardService({ config, store, forwarder, audit }) {
  return {
    sweep(ctx) {
      const access = config.access ?? {};
      const maxDurationMs = (access.max_duration_minutes ?? 30) * 60_000;
      const idleMs = (access.idle_timeout_minutes ?? 5) * 60_000;
      const retries = Math.max(1, config.guard?.teardown_retries ?? 3);
      const now = config.guard?.now ? new Date(config.guard.now) : ctx.now;

      const reclaimed = [];
      const failed = [];

      for (const session of store.listActiveSessions()) {
        const startedAge = now.getTime() - Date.parse(session.started_at);
        const idleAge = now.getTime() - Date.parse(session.last_active_at);
        if (startedAge <= maxDurationMs && idleAge <= idleMs) continue;
        const endReason = startedAge > maxDurationMs ? 'ttl_expired' : 'idle_timeout';

        let teardownError = null;
        for (let attempt = 0; attempt < retries; attempt += 1) {
          try {
            forwarder.close({ session_id: session.session_id });
            teardownError = null;
            break;
          } catch (error) {
            teardownError = error;
          }
        }

        if (teardownError !== null) {
          failed.push({ session_id: session.session_id, code: 'E_CHANNEL_TEARDOWN_FAILED' });
          audit.append(ctx, {
            event_type: 'teardown_failed',
            server_id: session.server_id,
            session_id: session.session_id,
            detail: { error: teardownError.message, retries, end_reason: endReason },
          });
          continue;
        }

        store.updateSession(session.session_id, {
          status: 'ended',
          ended_at: now.toISOString(),
          end_reason: endReason,
        });
        audit.append(ctx, {
          event_type: 'channel_closed',
          server_id: session.server_id,
          session_id: session.session_id,
          detail: { end_reason: endReason, reclaimed_by: 'guard' },
        });
        audit.append(ctx, {
          event_type: 'session_ended',
          server_id: session.server_id,
          session_id: session.session_id,
          detail: { end_reason: endReason, reclaimed_by: 'guard' },
        });
        reclaimed.push(session.session_id);
      }

      // 过期清理：未消费且过期的授权转 expired，对应的申请单转 expired。
      for (const grant of store.listIssuedGrants()) {
        if (Date.parse(grant.expires_at) > now.getTime()) continue;
        store.updateGrant(grant.grant_id, { status: 'expired' });
        const request = store.getRequest(grant.request_id);
        if (request !== null && request.status === 'approved') {
          store.updateRequest(request.request_id, { status: 'expired' });
        }
      }

      return ok({ reclaimed, failed });
    },
  };
}
