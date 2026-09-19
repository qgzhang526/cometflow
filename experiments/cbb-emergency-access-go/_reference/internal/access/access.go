// Package access：应急接入的申请、审批、吊销与查询（specs/access/spec.md）。
package access

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
	Store                 *store.Store
	Now                   contract.Clock
	MaxDurationMinutes    int
	RequireSecondApprover bool
	RejectLimitPerHour    int
	CircuitBreakMinutes   int
	SourceAllowed         func(ip string) bool
	TargetExists          func(serverID string) bool
}

// Request 发起一次应急接入申请。
func Request(d Deps, actor contract.Actor, sourceIP string, body map[string]any) contract.Result {
	if !actor.Has(contract.RoleRequester) {
		return contract.Fail(http.StatusForbidden, "E_FORBIDDEN_ROLE", "当前角色不允许发起申请")
	}
	if !d.SourceAllowed(sourceIP) {
		reject(d, sourceIP)
		return contract.Fail(http.StatusForbidden, "E_SOURCE_NOT_ALLOWED", "来源地址不在白名单内")
	}
	if limited(d, sourceIP) {
		return contract.Fail(http.StatusTooManyRequests, "E_RATE_LIMITED", "触发熔断，短期内禁止再次申请")
	}
	serverID := text(body, "server_id")
	if !d.TargetExists(serverID) {
		return contract.Fail(http.StatusNotFound, "E_SERVER_NOT_FOUND", "目标服务器未登记")
	}
	duration := number(body, "duration_minutes")
	if duration > d.MaxDurationMinutes {
		reject(d, sourceIP)
		return contract.Fail(http.StatusForbidden, "E_DURATION_EXCEEDS_LIMIT", "申请时长超过配置上限")
	}
	reason := text(body, "reason")
	now := d.Now()
	request := store.Request{
		ID:              "req-" + randomID(),
		ActorID:         actor.ID,
		ServerID:        serverID,
		Reason:          reason,
		DurationMinutes: duration,
		Status:          "pending",
		IssuedAt:        now,
		RequestID:       text(body, "x_request_id"),
	}
	if err := d.Store.CreateRequest(request); err != nil {
		return contract.Fail(http.StatusInternalServerError, "E_AUDIT_WRITE_FAILED", err.Error())
	}
	_ = d.Store.AppendEvent("request_created", actor.ID, request.ID, request.RequestID, reason, now)
	return contract.OK(map[string]any{
		"request_id":       request.ID,
		"status":           request.Status,
		"server_id":        request.ServerID,
		"duration_minutes": request.DurationMinutes,
		"issued_at":        stamp(now),
	})
}

// Approve 审批申请并发放一次性授权。
func Approve(d Deps, actor contract.Actor, body map[string]any) contract.Result {
	if !actor.Has(contract.RoleApprover) {
		return contract.Fail(http.StatusForbidden, "E_FORBIDDEN_ROLE", "当前角色不允许审批")
	}
	requestID := text(body, "request_id")
	request, err := d.Store.FindRequest(requestID)
	if err != nil {
		return contract.Fail(http.StatusNotFound, "E_REQUEST_NOT_FOUND", "申请单不存在")
	}
	if request.ActorID == actor.ID {
		return contract.Fail(http.StatusForbidden, "E_SELF_APPROVAL", "申请人不能审批自己的申请")
	}
	if request.Status != "pending" {
		return contract.Fail(http.StatusConflict, "E_REQUEST_ALREADY_DECIDED", "申请单已被审批")
	}
	now := d.Now()
	if text(body, "decision") != "approve" {
		reject(d, "")
		_ = d.Store.DecideRequest(request.ID, "rejected", actor.ID, now)
		_ = d.Store.AppendEvent("request_rejected", actor.ID, request.ID, request.RequestID, "", now)
		return contract.OK(map[string]any{"request_id": request.ID, "status": "rejected"})
	}
	if err := d.Store.DecideRequest(request.ID, "approved", actor.ID, now); err != nil {
		return contract.Fail(http.StatusInternalServerError, "E_AUDIT_WRITE_FAILED", err.Error())
	}
	token := randomID() + randomID()
	grant := store.Grant{
		ID:        "grant-" + randomID(),
		RequestID: request.ID,
		TokenHash: hash(token),
		Status:    "issued",
		IssuedAt:  now,
	}
	if err := d.Store.CreateGrant(grant); err != nil {
		return contract.Fail(http.StatusInternalServerError, "E_AUDIT_WRITE_FAILED", err.Error())
	}
	_ = d.Store.AppendEvent("request_approved", actor.ID, request.ID, request.RequestID, "", now)
	_ = d.Store.AppendEvent("grant_issued", actor.ID, grant.ID, request.RequestID, "", now)
	return contract.OK(map[string]any{
		"request_id": request.ID,
		"status":     "approved",
		"grant": map[string]any{
			"grant_id":  grant.ID,
			"status":    grant.Status,
			"token":     token, // 只在这里出现一次；状态查询不回显
			"issued_at": stamp(now),
		},
	})
}

// Revoke 吊销申请与关联授权。
func Revoke(d Deps, actor contract.Actor, body map[string]any) contract.Result {
	if !actor.Has(contract.RoleApprover) {
		return contract.Fail(http.StatusForbidden, "E_FORBIDDEN_ROLE", "当前角色不允许吊销")
	}
	requestID := text(body, "request_id")
	request, err := d.Store.FindRequest(requestID)
	if err != nil {
		return contract.Fail(http.StatusNotFound, "E_REQUEST_NOT_FOUND", "申请单不存在")
	}
	now := d.Now()
	if err := d.Store.DecideRequest(request.ID, "revoked", actor.ID, now); err != nil {
		return contract.Fail(http.StatusInternalServerError, "E_AUDIT_WRITE_FAILED", err.Error())
	}
	grantStatus := "revoked"
	if grant, err := d.Store.FindGrantByRequest(request.ID); err == nil {
		_ = d.Store.UpdateGrantStatus(grant.ID, "revoked", nil)
	}
	_ = d.Store.AppendEvent("request_revoked", actor.ID, request.ID, request.RequestID, "", now)
	return contract.OK(map[string]any{
		"request_id": request.ID,
		"status":     "revoked",
		"grant":      map[string]any{"status": grantStatus},
	})
}

// Status 查询申请、授权与会话状态；不回显明文令牌，也不暴露 token_hash。
func Status(d Deps, actor contract.Actor, requestID string) contract.Result {
	request, err := d.Store.FindRequest(requestID)
	if err != nil {
		return contract.Fail(http.StatusNotFound, "E_REQUEST_NOT_FOUND", "申请单不存在")
	}
	data := map[string]any{
		"request": map[string]any{
			"request_id": request.ID,
			"status":     request.Status,
			"server_id":  request.ServerID,
			"issued_at":  stamp(request.IssuedAt),
		},
		"grant":   nil,
		"session": nil,
	}
	if grant, err := d.Store.FindGrantByRequest(request.ID); err == nil {
		data["grant"] = map[string]any{
			"grant_id":  grant.ID,
			"status":    grant.Status,
			"issued_at": stamp(grant.IssuedAt),
		}
		if sessions, err := d.Store.ActiveSessions(); err == nil {
			for _, session := range sessions {
				if session.GrantID == grant.ID {
					data["session"] = map[string]any{
						"session_id": session.ID,
						"status":     session.Status,
						"server_id":  session.ServerID,
						"started_at": stamp(session.StartedAt),
					}
				}
			}
		}
	}
	return contract.OK(data)
}

func limited(d Deps, sourceIP string) bool {
	if d.RejectLimitPerHour <= 0 || sourceIP == "" {
		return false
	}
	since := d.Now().Add(-time.Hour)
	count, err := d.Store.CountRejectionsSince(sourceIP, since)
	return err == nil && count >= d.RejectLimitPerHour
}

func reject(d Deps, sourceIP string) {
	if sourceIP == "" {
		return
	}
	_ = d.Store.RecordRejection(sourceIP, d.Now())
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

func number(body map[string]any, key string) int {
	switch value := body[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	default:
		return 0
	}
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
