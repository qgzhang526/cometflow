// Package tunnel：临时通道的建立与回收（specs/tunnel/spec.md）。
//
// 本 CBB 只负责授权的判定与生命周期，真正的转发交给转发器适配器；
// 「不产生转发规则」是这几条判据的核心事实，所以所有拒绝路径都必须在调用转发器之前返回。
package tunnel

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"

	"cbb-emergency-access/internal/contract"
	"cbb-emergency-access/internal/store"
)

type Deps struct {
	Store         *store.Store
	Now           contract.Clock
	Forwarder     contract.Forwarder
	SourceAllowed func(ip string) bool
	TargetOnline  func(serverID string) (exists bool, online bool)
	ListenPort    int
	ForwardToPort int
}

// Open 用一次性令牌换一条临时通道。
func Open(d Deps, actor contract.Actor, sourceIP string, body map[string]any) contract.Result {
	if !actor.Has(contract.RoleRequester) {
		return contract.Fail(http.StatusForbidden, "E_FORBIDDEN_ROLE", "当前角色不允许建立通道")
	}
	token := text(body, "token")
	grant, err := d.Store.FindGrantByTokenHash(hash(token))
	if err != nil {
		return contract.Fail(http.StatusNotFound, "E_GRANT_NOT_FOUND", "授权不存在")
	}
	switch grant.Status {
	case "revoked":
		return contract.Fail(http.StatusForbidden, "E_GRANT_REVOKED", "授权已被吊销")
	case "consumed":
		return contract.Fail(http.StatusConflict, "E_GRANT_ALREADY_USED", "一次性令牌已被消费")
	}
	now := d.Now()
	if request, err := d.Store.FindRequest(grant.RequestID); err == nil {
		if now.After(request.IssuedAt.Add(time.Duration(request.DurationMinutes) * time.Minute)) {
			return contract.Fail(http.StatusForbidden, "E_GRANT_EXPIRED", "授权已过期")
		}
	}
	// 来源校验必须在转发器之前：白名单外的来源不得产生任何规则。
	if !d.SourceAllowed(sourceIP) {
		return contract.Fail(http.StatusForbidden, "E_SOURCE_NOT_ALLOWED", "来源地址不在白名单内")
	}
	serverID := text(body, "server_id")
	exists, online := d.TargetOnline(serverID)
	if !exists {
		return contract.Fail(http.StatusNotFound, "E_SERVER_NOT_FOUND", "目标服务器未登记")
	}
	if !online {
		return contract.Fail(http.StatusForbidden, "E_SERVER_OFFLINE", "目标服务器不可达")
	}

	session := store.Session{
		ID:        "sess-" + randomID(),
		GrantID:   grant.ID,
		ServerID:  serverID,
		SourceIP:  sourceIP,
		Status:    "active",
		StartedAt: now,
	}
	rule, err := d.Forwarder.Open(contract.ForwardSpec{
		SessionID:     session.ID,
		ServerID:      serverID,
		SourceIP:      sourceIP,
		ListenPort:    d.ListenPort,
		ForwardToPort: d.ForwardToPort,
	})
	if err != nil {
		return contract.Fail(http.StatusInternalServerError, "E_CHANNEL_SETUP_FAILED", err.Error())
	}
	_ = rule
	if err := d.Store.CreateSession(session); err != nil {
		return contract.Fail(http.StatusInternalServerError, "E_CHANNEL_SETUP_FAILED", err.Error())
	}
	consumed := now
	_ = d.Store.UpdateGrantStatus(grant.ID, "consumed", &consumed)
	_ = d.Store.AppendEvent("channel_opened", actor.ID, session.ID, "", serverID, now)
	return contract.OK(map[string]any{
		"session_id": session.ID,
		"status":     session.Status,
		"server_id":  session.ServerID,
		"started_at": stamp(now),
	})
}

// Close 回收通道；重复回收必须幂等（A13）。
func Close(d Deps, actor contract.Actor, body map[string]any) contract.Result {
	sessionID := text(body, "session_id")
	session, err := d.Store.FindSession(sessionID)
	if err != nil {
		return contract.Fail(http.StatusNotFound, "E_SESSION_NOT_FOUND", "会话不存在")
	}
	now := d.Now()
	reason := "manual_close"
	if session.Status == "active" {
		if err := d.Forwarder.Close(session.ID); err != nil {
			_ = d.Store.AppendEvent("session_teardown_failed", actor.ID, session.ID, "", err.Error(), now)
			return contract.Fail(http.StatusInternalServerError, "E_CHANNEL_TEARDOWN_FAILED", err.Error())
		}
		changed, err := d.Store.EndSession(session.ID, reason, now)
		if err != nil {
			return contract.Fail(http.StatusInternalServerError, "E_CHANNEL_TEARDOWN_FAILED", err.Error())
		}
		if changed {
			_ = d.Store.AppendEvent("session_ended", actor.ID, session.ID, "", reason, now)
		}
		session, _ = d.Store.FindSession(sessionID)
	}
	return contract.OK(sessionView(session))
}

func sessionView(session *store.Session) map[string]any {
	view := map[string]any{
		"session_id": session.ID,
		"status":     session.Status,
		"server_id":  session.ServerID,
		"end_reason": session.EndReason,
		"started_at": stamp(session.StartedAt),
	}
	if session.EndedAt != nil {
		view["ended_at"] = stamp(*session.EndedAt)
	}
	return view
}

func hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func randomID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "fallback"
	}
	return hex.EncodeToString(buf)
}

func text(body map[string]any, key string) string {
	value, _ := body[key].(string)
	return value
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
