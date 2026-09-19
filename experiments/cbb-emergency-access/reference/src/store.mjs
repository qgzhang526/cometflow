/**
 * 存储层：models.md 的 6 个实体 + append-only 审计流。
 *
 * 用 Node 24 内置的 node:sqlite，零外部依赖（见 constraints.md 的离线依赖管理）。
 * 审计表用触发器挡住 UPDATE / DELETE：append-only 由数据库保证，而不是靠调用方自觉。
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS server_target (
  server_id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  mgmt_endpoint TEXT NOT NULL,
  ssh_port INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS access_request (
  request_id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  requester TEXT NOT NULL,
  reason TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  decided_at TEXT,
  revoked_at TEXT,
  request_trace TEXT
);

CREATE TABLE IF NOT EXISTS approval_decision (
  decision_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  approver TEXT NOT NULL,
  decision TEXT NOT NULL,
  comment TEXT,
  decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS access_grant (
  grant_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS access_session (
  session_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  source_ip TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_event (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  server_id TEXT,
  request_id TEXT,
  session_id TEXT,
  detail TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS audit_event_append_only_update
BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_event_append_only_delete
BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;
`;

function toJson(value) {
  return value === undefined ? null : JSON.stringify(value);
}

export function openStore({ file = ':memory:' } = {}) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);

  return {
    db,
    close() {
      db.close();
    },

    upsertTarget(target) {
      db.prepare(
        `INSERT INTO server_target (server_id, hostname, mgmt_endpoint, ssh_port, status)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(server_id) DO UPDATE SET
           hostname = excluded.hostname,
           mgmt_endpoint = excluded.mgmt_endpoint,
           ssh_port = excluded.ssh_port,
           status = excluded.status`,
      ).run(target.server_id, target.hostname, target.mgmt_endpoint, target.ssh_port, target.status);
    },
    getTarget(serverId) {
      return db.prepare('SELECT * FROM server_target WHERE server_id = ?').get(serverId) ?? null;
    },

    insertRequest(request) {
      db.prepare(
        `INSERT INTO access_request
           (request_id, server_id, requester, reason, duration_minutes, status, created_at, expires_at, decided_at, revoked_at, request_trace)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        request.request_id,
        request.server_id,
        request.requester,
        request.reason,
        request.duration_minutes,
        request.status,
        request.created_at,
        request.expires_at ?? null,
        request.decided_at ?? null,
        request.revoked_at ?? null,
        request.request_trace ?? null,
      );
    },
    getRequest(requestId) {
      return db.prepare('SELECT * FROM access_request WHERE request_id = ?').get(requestId) ?? null;
    },
    updateRequest(requestId, patch) {
      const entries = Object.entries(patch);
      if (entries.length === 0) return;
      const assignments = entries.map(([key]) => key + ' = ?').join(', ');
      db.prepare('UPDATE access_request SET ' + assignments + ' WHERE request_id = ?').run(
        ...entries.map(([, value]) => value ?? null),
        requestId,
      );
    },

    insertDecision(decision) {
      db.prepare(
        `INSERT INTO approval_decision (decision_id, request_id, approver, decision, comment, decided_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        decision.request_id,
        decision.approver,
        decision.decision,
        decision.comment ?? null,
        decision.decided_at,
      );
    },
    listApprovals(requestId) {
      return db.prepare('SELECT * FROM approval_decision WHERE request_id = ? ORDER BY decided_at ASC').all(requestId);
    },

    insertGrant(grant) {
      db.prepare(
        `INSERT INTO access_grant (grant_id, request_id, token_hash, issued_at, expires_at, used, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        grant.grant_id,
        grant.request_id,
        grant.token_hash,
        grant.issued_at,
        grant.expires_at,
        grant.used ? 1 : 0,
        grant.status,
      );
    },
    getGrant(grantId) {
      return db.prepare('SELECT * FROM access_grant WHERE grant_id = ?').get(grantId) ?? null;
    },
    getGrantByTokenHash(tokenHash) {
      return db.prepare('SELECT * FROM access_grant WHERE token_hash = ?').get(tokenHash) ?? null;
    },
    getGrantByRequest(requestId) {
      return db.prepare('SELECT * FROM access_grant WHERE request_id = ? ORDER BY issued_at ASC LIMIT 1').get(requestId) ?? null;
    },
    listGrantsByRequest(requestId) {
      return db.prepare('SELECT * FROM access_grant WHERE request_id = ? ORDER BY issued_at ASC').all(requestId);
    },
    listIssuedGrants() {
      return db.prepare("SELECT * FROM access_grant WHERE status = 'issued' ORDER BY issued_at ASC").all();
    },
    countRejectionsSince(serverId, sinceIso) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS total
             FROM approval_decision d
             JOIN access_request r ON r.request_id = d.request_id
            WHERE r.server_id = ? AND d.decision = 'reject' AND d.decided_at >= ?`,
        )
        .get(serverId, sinceIso);
      return Number(row?.total ?? 0);
    },
    updateGrant(grantId, patch) {
      const entries = Object.entries(patch);
      if (entries.length === 0) return;
      const assignments = entries.map(([key]) => key + ' = ?').join(', ');
      db.prepare('UPDATE access_grant SET ' + assignments + ' WHERE grant_id = ?').run(
        ...entries.map(([key, value]) => (key === 'used' ? (value ? 1 : 0) : value ?? null)),
        grantId,
      );
    },

    insertSession(session) {
      db.prepare(
        `INSERT INTO access_session
           (session_id, grant_id, server_id, source_ip, started_at, last_active_at, ended_at, end_reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        session.session_id,
        session.grant_id,
        session.server_id,
        session.source_ip,
        session.started_at,
        session.last_active_at,
        session.ended_at ?? null,
        session.end_reason ?? null,
        session.status,
      );
    },
    getSession(sessionId) {
      return db.prepare('SELECT * FROM access_session WHERE session_id = ?').get(sessionId) ?? null;
    },
    getSessionByGrant(grantId) {
      return db.prepare('SELECT * FROM access_session WHERE grant_id = ? ORDER BY started_at DESC LIMIT 1').get(grantId) ?? null;
    },
    listActiveSessions() {
      return db.prepare("SELECT * FROM access_session WHERE status = 'active' ORDER BY started_at ASC").all();
    },
    updateSession(sessionId, patch) {
      const entries = Object.entries(patch);
      if (entries.length === 0) return;
      const assignments = entries.map(([key]) => key + ' = ?').join(', ');
      db.prepare('UPDATE access_session SET ' + assignments + ' WHERE session_id = ?').run(
        ...entries.map(([, value]) => value ?? null),
        sessionId,
      );
    },

    appendAudit(event) {
      db.prepare(
        `INSERT INTO audit_event (event_id, event_type, actor, server_id, request_id, session_id, detail, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        event.event_type,
        event.actor,
        event.server_id ?? null,
        event.request_id ?? null,
        event.session_id ?? null,
        toJson(event.detail),
        event.occurred_at,
      );
    },
    listAudit(from, to) {
      return db
        .prepare(
          'SELECT * FROM audit_event WHERE occurred_at >= ? AND occurred_at <= ? ORDER BY occurred_at ASC, rowid ASC',
        )
        .all(from, to);
    },
  };
}
