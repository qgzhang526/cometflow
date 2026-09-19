// Package store 是存储层：实体表与 append-only 审计（specs/models.md）。
//
// 参考实现用纯 Go 的 SQLite 驱动（modernc.org/sqlite，免 cgo），这是本项目唯一允许的第三方依赖。
// 时间一律由外部注入的时钟给，存储层不读系统时间——否则注入假时钟的验收会取不到事件。
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("store: 记录不存在")

type Store struct {
	db  *sql.DB
	now func() time.Time
}

type Request struct {
	ID              string
	ActorID         string
	ServerID        string
	Reason          string
	DurationMinutes int
	Status          string
	IssuedAt        time.Time
	DecidedAt       *time.Time
	ApproverID      string
	RequestID       string
}

type Grant struct {
	ID         string
	RequestID  string
	TokenHash  string
	Status     string
	IssuedAt   time.Time
	ConsumedAt *time.Time
}

type Session struct {
	ID         string
	GrantID    string
	ServerID   string
	SourceIP   string
	Status     string
	EndReason  string
	StartedAt  time.Time
	EndedAt    *time.Time
}

type Event struct {
	Seq        int64
	EventType  string
	ActorID    string
	Subject    string
	RequestID  string
	OccurredAt time.Time
	Detail     string
}

const schema = `
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, server_id TEXT NOT NULL, reason TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL, status TEXT NOT NULL, issued_at TEXT NOT NULL,
  decided_at TEXT, approver_id TEXT, request_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL, token_hash TEXT NOT NULL, status TEXT NOT NULL,
  issued_at TEXT NOT NULL, consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, server_id TEXT NOT NULL, source_ip TEXT NOT NULL,
  status TEXT NOT NULL, end_reason TEXT, started_at TEXT NOT NULL, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, actor_id TEXT NOT NULL,
  subject TEXT, request_id TEXT, occurred_at TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS rejections (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, source_ip TEXT NOT NULL, occurred_at TEXT NOT NULL
);
`

func Open(path string, now func() time.Time) (*Store, error) {
	if now == nil {
		return nil, errors.New("store: 必须注入时钟")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("打开数据库 %s: %w", path, err)
	}
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("建表失败: %w", err)
	}
	return &Store{db: db, now: now}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) CreateRequest(r Request) error {
	_, err := s.db.Exec(
		`INSERT INTO requests (id, actor_id, server_id, reason, duration_minutes, status, issued_at, decided_at, approver_id, request_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '', ?)`,
		r.ID, r.ActorID, r.ServerID, r.Reason, r.DurationMinutes, r.Status, stamp(r.IssuedAt), r.RequestID,
	)
	return err
}

func (s *Store) FindRequest(id string) (*Request, error) {
	row := s.db.QueryRow(
		`SELECT id, actor_id, server_id, reason, duration_minutes, status, issued_at, decided_at, approver_id, request_id
		 FROM requests WHERE id = ?`, id)
	var r Request
	var issued string
	var decided sql.NullString
	if err := row.Scan(&r.ID, &r.ActorID, &r.ServerID, &r.Reason, &r.DurationMinutes, &r.Status, &issued, &decided, &r.ApproverID, &r.RequestID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	r.IssuedAt = parse(issued)
	if decided.Valid {
		at := parse(decided.String)
		r.DecidedAt = &at
	}
	return &r, nil
}

func (s *Store) DecideRequest(id, status, approverID string, at time.Time) error {
	_, err := s.db.Exec(
		`UPDATE requests SET status = ?, decided_at = ?, approver_id = ? WHERE id = ?`,
		status, stamp(at), approverID, id)
	return err
}

func (s *Store) CreateGrant(g Grant) error {
	_, err := s.db.Exec(
		`INSERT INTO grants (id, request_id, token_hash, status, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?, NULL)`,
		g.ID, g.RequestID, g.TokenHash, g.Status, stamp(g.IssuedAt))
	return err
}

func (s *Store) FindGrantByRequest(requestID string) (*Grant, error) {
	return s.scanGrant(s.db.QueryRow(
		`SELECT id, request_id, token_hash, status, issued_at, consumed_at FROM grants WHERE request_id = ?`, requestID))
}

func (s *Store) FindGrantByTokenHash(hash string) (*Grant, error) {
	return s.scanGrant(s.db.QueryRow(
		`SELECT id, request_id, token_hash, status, issued_at, consumed_at FROM grants WHERE token_hash = ?`, hash))
}

func (s *Store) scanGrant(row *sql.Row) (*Grant, error) {
	var g Grant
	var issued string
	var consumed sql.NullString
	if err := row.Scan(&g.ID, &g.RequestID, &g.TokenHash, &g.Status, &issued, &consumed); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	g.IssuedAt = parse(issued)
	if consumed.Valid {
		at := parse(consumed.String)
		g.ConsumedAt = &at
	}
	return &g, nil
}

func (s *Store) UpdateGrantStatus(id, status string, consumedAt *time.Time) error {
	var consumed any
	if consumedAt != nil {
		consumed = stamp(*consumedAt)
	}
	_, err := s.db.Exec(`UPDATE grants SET status = ?, consumed_at = ? WHERE id = ?`, status, consumed, id)
	return err
}

func (s *Store) CreateSession(sess Session) error {
	_, err := s.db.Exec(
		`INSERT INTO sessions (id, grant_id, server_id, source_ip, status, end_reason, started_at, ended_at)
		 VALUES (?, ?, ?, ?, ?, '', ?, NULL)`,
		sess.ID, sess.GrantID, sess.ServerID, sess.SourceIP, sess.Status, stamp(sess.StartedAt))
	return err
}

func (s *Store) FindSession(id string) (*Session, error) {
	row := s.db.QueryRow(
		`SELECT id, grant_id, server_id, source_ip, status, end_reason, started_at, ended_at FROM sessions WHERE id = ?`, id)
	var sess Session
	var started string
	var ended sql.NullString
	var reason sql.NullString
	if err := row.Scan(&sess.ID, &sess.GrantID, &sess.ServerID, &sess.SourceIP, &sess.Status, &reason, &started, &ended); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	sess.StartedAt = parse(started)
	sess.EndReason = reason.String
	if ended.Valid {
		at := parse(ended.String)
		sess.EndedAt = &at
	}
	return &sess, nil
}

// EndSession 只在会话仍为 active 时写入，返回是否真的改动了。
// 重复回收要走「读回原值」的路径，所以这里不能覆盖已结束的 ended_at / end_reason（A13）。
func (s *Store) EndSession(id, reason string, at time.Time) (bool, error) {
	res, err := s.db.Exec(
		`UPDATE sessions SET status = 'ended', end_reason = ?, ended_at = ? WHERE id = ? AND status = 'active'`,
		reason, stamp(at), id)
	if err != nil {
		return false, err
	}
	affected, err := res.RowsAffected()
	return affected > 0, err
}

func (s *Store) ActiveSessions() ([]Session, error) {
	rows, err := s.db.Query(
		`SELECT id, grant_id, server_id, source_ip, status, end_reason, started_at, ended_at FROM sessions WHERE status = 'active'`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Session{}
	for rows.Next() {
		var sess Session
		var started string
		var ended sql.NullString
		var reason sql.NullString
		if err := rows.Scan(&sess.ID, &sess.GrantID, &sess.ServerID, &sess.SourceIP, &sess.Status, &reason, &started, &ended); err != nil {
			return nil, err
		}
		sess.StartedAt = parse(started)
		sess.EndReason = reason.String
		if ended.Valid {
			at := parse(ended.String)
			sess.EndedAt = &at
		}
		out = append(out, sess)
	}
	return out, rows.Err()
}

// AppendEvent 是 append-only 的：只插不改不删。
func (s *Store) AppendEvent(eventType, actorID, subject, requestID, detail string, at time.Time) error {
	_, err := s.db.Exec(
		`INSERT INTO events (event_type, actor_id, subject, request_id, occurred_at, detail) VALUES (?, ?, ?, ?, ?, ?)`,
		eventType, actorID, subject, requestID, stamp(at), detail)
	return err
}

func (s *Store) EventsBetween(from, to time.Time) ([]Event, error) {
	rows, err := s.db.Query(
		`SELECT seq, event_type, actor_id, subject, request_id, occurred_at, detail
		 FROM events WHERE occurred_at >= ? AND occurred_at <= ? ORDER BY seq ASC`,
		stamp(from), stamp(to))
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Event{}
	for rows.Next() {
		var e Event
		var occurred string
		var subject, requestID, detail sql.NullString
		if err := rows.Scan(&e.Seq, &e.EventType, &e.ActorID, &subject, &requestID, &occurred, &detail); err != nil {
			return nil, err
		}
		e.Subject = subject.String
		e.RequestID = requestID.String
		e.Detail = detail.String
		e.OccurredAt = parse(occurred)
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) RecordRejection(sourceIP string, at time.Time) error {
	_, err := s.db.Exec(`INSERT INTO rejections (source_ip, occurred_at) VALUES (?, ?)`, sourceIP, stamp(at))
	return err
}

func (s *Store) CountRejectionsSince(sourceIP string, since time.Time) (int, error) {
	var count int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM rejections WHERE source_ip = ? AND occurred_at >= ?`,
		sourceIP, stamp(since)).Scan(&count)
	return count, err
}

// 时间统一按 RFC3339（UTC）存字符串：可比较、可排序、可读，不依赖驱动的时区行为。
func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func parse(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed
	}
	parsed, _ := time.Parse(time.RFC3339, value)
	return parsed
}
