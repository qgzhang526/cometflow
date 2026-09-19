/**
 * audit capability：按时间范围导出审计流。
 *
 * 导出是只读的，但导出行为本身也要落一条 audit_exported（在返回之后写入，
 * 因此不计入本次 count——见 audit/spec.md）。
 */
function ok(data) {
  return { status: 200, code: 0, message: '', data };
}

function toApiEvent(row) {
  let detail = null;
  if (typeof row.detail === 'string' && row.detail !== '') {
    try {
      detail = JSON.parse(row.detail);
    } catch {
      detail = row.detail;
    }
  }
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    actor: row.actor,
    server_id: row.server_id,
    request_id: row.request_id,
    session_id: row.session_id,
    detail,
    occurred_at: row.occurred_at,
  };
}

export function createAuditService({ store, audit }) {
  return {
    export(ctx, query) {
      const from = query.get('from') ?? '1970-01-01T00:00:00.000Z';
      const to = query.get('to') ?? new Date().toISOString();
      const events = store.listAudit(from, to).map(toApiEvent);
      audit.append(ctx, {
        event_type: 'audit_exported',
        detail: { from, to, count: events.length },
      });
      return ok({ count: events.length, events });
    },
  };
}
