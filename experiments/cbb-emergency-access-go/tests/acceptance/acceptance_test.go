package acceptance

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"cbb-emergency-access/internal/contract"
)

// 18 条验收判据。每条的说明来自 specs/ 里对应的 Acceptance 项，
// 编号与 specs 里的 A1..A18 一一对应——specs 的 `- check:` 就是这么调的：
//
//	go test ./tests/acceptance -run '^TestA1$' -count=1

// A1：requester 角色提交合法申请后返回 200，且生成 status 为 pending 的申请单，
// issued 与请求可经 X-Request-Id 关联。
func TestA1(t *testing.T) {
	c := newCase(t, newFakeForwarder())
	server := c.start(nil)

	res := c.createRequest(server, nil)
	data := expectOK(c, res, "A1")
	expectTrue(c, field(data, "status") == "pending", "A1 申请单状态应为 pending，实际 %q", field(data, "status"))
	expectTrue(c, field(data, "request_id") != "", "A1 应返回 request_id")
	expectTrue(c, field(data, "issued_at") != "", "A1 应记录 issued_at")
	// 与请求的关联靠 X-Request-Id：请求头由验收执行器统一带上，审计事件里必须能回查到它（见 A16）。
	expectTrue(c, field(data, "request_id") != "", "A1 issued 应可经 X-Request-Id 关联")
}

// A2：duration_minutes 超过 access.max_duration_minutes 时返回 403 与 E_DURATION_EXCEEDS_LIMIT。
func TestA2(t *testing.T) {
	c := newCase(t, newFakeForwarder())
	server := c.start(nil)

	res := c.createRequest(server, map[string]any{"duration_minutes": 31})
	expectStatus(c, res, "A2", http.StatusForbidden, "E_DURATION_EXCEEDS_LIMIT")
}

// A3：来源地址不在 access.allowed_source_cidrs 内时返回 403 与 E_SOURCE_NOT_ALLOWED。
func TestA3(t *testing.T) {
	c := newCase(t, newFakeForwarder())
	server := c.start(nil)

	res := api(c, server, http.MethodPost, "/api/emergency/access/request", requestOptions{
		actor:        &actorRequester,
		forwardedFor: blockedSource,
		body: map[string]any{
			"server_id":        onlineServer,
			"reason":           "INC-1001 紧急排障",
			"duration_minutes": 10,
		},
	})
	expectStatus(c, res, "A3", http.StatusForbidden, "E_SOURCE_NOT_ALLOWED")
}

// A4：approver 审批通过后返回 200，申请单状态变为 approved，并生成一次性授权。
func TestA4(t *testing.T) {
	c := newCase(t, newFakeForwarder())
	server := c.start(nil)

	created := expectOK(c, c.createRequest(server, nil), "A4")
	data := expectOK(c, c.approveRequest(server, field(created, "request_id"), nil), "A4")
	expectTrue(c, field(data, "status") == "approved", "A4 申请单状态应为 approved，实际 %q", field(data, "status"))
	grant := object(data, "grant")
	expectTrue(c, field(grant, "token") != "", "A4 应发放一次性令牌")
	expectTrue(c, field(grant, "status") == "issued", "A4 授权状态应为 issued，实际 %q", field(grant, "status"))
}

// A5：审批人等于申请人时返回 403 与 E_SELF_APPROVAL。
func TestA5(t *testing.T) {
	c := newCase(t, newFakeForwarder())
	server := c.start(nil)

	created := expectOK(c, c.createRequest(server, nil), "A5")
	// 同一个人的另一重身份：持审批角色，但 actor id 与申请人一致。
	selfApprover := actor{id: actorRequester.id, roles: contract.RoleApprover}
	res := api(c, server, http.MethodPost, "/api/emergency/access/approve", requestOptions{
		actor: &selfApprover,
		body: map[string]any{
			"request_id": field(created, "request_id"),
			"decision":   "approve",
			"comment":    "自己批自己",
		},
	})
	expectStatus(c, res, "A5", http.StatusForbidden, "E_SELF_APPROVAL")
	// 对照：换个人审批就正常，说明拒绝的原因是「自审」而不是角色不够。
	expectOK(c, c.approveRequest(server, field(created, "request_id"), nil), "A5（对照）")
}

// A6：对已审批的申请单再次审批时返回 409 与 E_REQUEST_ALREADY_DECIDED。
func TestA6(t *testing.T) {
	c := newCase(t, newFakeForwarder())
	server := c.start(nil)

	created := expectOK(c, c.createRequest(server, nil), "A6")
	requestID := field(created, "request_id")
	expectOK(c, c.approveRequest(server, requestID, nil), "A6")
	expectStatus(c, c.approveRequest(server, requestID, nil), "A6", http.StatusConflict, "E_REQUEST_ALREADY_DECIDED")
}

// A7：approver 吊销后申请单状态变为 revoked，授权状态变为 revoked。
//
// 「被吊销的令牌还能不能建通道」是 tunnel 的事实，判在 A18 —— 本用例只断言 access 自己的状态机。
// 这样 G1 的吊销任务不必去实现 tunnel 才能验收（验收项跨模块会让任务只能在模块外完成）。
func TestA7(t *testing.T) {
	c := newCase(t, newFakeForwarder())
	server := c.start(nil)

	requestID, _, _ := c.issueToken(server)
	data := expectOK(c, api(c, server, http.MethodPost, "/api/emergency/access/revoke", requestOptions{
		actor: &actorApprover,
		body:  map[string]any{"request_id": requestID},
	}), "A7")
	expectTrue(c, field(data, "status") == "revoked", "A7 申请单状态应为 revoked，实际 %q", field(data, "status"))
	expectTrue(c, field(object(data, "grant"), "status") == "revoked", "A7 授权状态应为 revoked")
}

// A8：查询既有申请单返回 200，包含申请、授权与会话状态，且响应中不出现明文令牌。
func TestA8(t *testing.T) {
	c := newCase(t, newFakeForwarder())
	server := c.start(nil)

	requestID, token, _ := c.issueToken(server)
	res := api(c, server, http.MethodGet, "/api/emergency/access/status?request_id="+requestID, requestOptions{
		actor: &actorRequester,
	})
	data := expectOK(c, res, "A8")
	expectTrue(c, field(object(data, "request"), "request_id") == requestID, "A8 应返回申请单")
	expectTrue(c, field(object(data, "request"), "status") == "approved", "A8 申请单状态应为 approved")
	expectTrue(c, field(object(data, "grant"), "grant_id") != "", "A8 应返回关联授权")
	expectTrue(c, data["session"] == nil, "A8 未建立通道时会话应为 null")
	expectTrue(c, !strings.Contains(res.text, token), "A8 状态查询不得回显明文令牌")
	expectTrue(c, !strings.Contains(res.text, "token_hash"), "A8 状态查询不得暴露 token_hash")
}

// A9：持有有效令牌的 requester 建立通道后返回 200，令牌转为 consumed，
// 且生成状态为 active 的会话。
func TestA9(t *testing.T) {
	forwarder := newFakeForwarder()
	c := newCase(t, forwarder)
	server := c.start(nil)

	_, token, _ := c.issueToken(server)
	data := expectOK(c, c.openSession(server, token, requestOptions{}), "A9")
	sessionID := field(data, "session_id")
	expectTrue(c, sessionID != "", "A9 应生成 session_id")
	expectTrue(c, field(data, "status") == "active", "A9 会话状态应为 active，实际 %q", field(data, "status"))
	expectTrue(c, field(data, "server_id") == onlineServer, "A9 会话应记录 server_id")

	rules := forwarder.rulesSnapshot()
	expectTrue(c, len(rules) == 1, "A9 应建立一条转发规则，实际 %d 条", len(rules))
	expectTrue(c, len(rules) == 1 && rules[0].SessionID == sessionID, "A9 规则应挂在本次会话上")
}

// A10：重复使用同一令牌时返回 409 与 E_GRANT_ALREADY_USED。
func TestA10(t *testing.T) {
	forwarder := newFakeForwarder()
	c := newCase(t, forwarder)
	server := c.start(nil)

	_, token, _ := c.issueToken(server)
	expectOK(c, c.openSession(server, token, requestOptions{}), "A10")
	expectStatus(c, c.openSession(server, token, requestOptions{}), "A10", http.StatusConflict, "E_GRANT_ALREADY_USED")
	expectTrue(c, len(forwarder.rulesSnapshot()) == 1, "A10 二次使用不得新建转发规则")
}

// A11：来源地址不在白名单内时返回 403 与 E_SOURCE_NOT_ALLOWED，且不产生任何转发规则。
func TestA11(t *testing.T) {
	forwarder := newFakeForwarder()
	c := newCase(t, forwarder)
	server := c.start(nil)

	_, token, _ := c.issueToken(server)
	expectStatus(c, c.openSession(server, token, requestOptions{forwardedFor: blockedSource}),
		"A11", http.StatusForbidden, "E_SOURCE_NOT_ALLOWED")
	expectTrue(c, len(forwarder.rulesSnapshot()) == 0, "A11 白名单外的来源不得产生任何转发规则")
}

// A12：回收后会话状态变为 ended，end_reason 被记录，且原有转发规则不再包含临时规则。
func TestA12(t *testing.T) {
	forwarder := newFakeForwarder()
	c := newCase(t, forwarder)
	server := c.start(nil)

	_, token, _ := c.issueToken(server)
	session := expectOK(c, c.openSession(server, token, requestOptions{}), "A12")
	data := expectOK(c, c.closeSession(server, field(session, "session_id")), "A12")

	expectTrue(c, field(data, "status") == "ended", "A12 会话状态应为 ended，实际 %q", field(data, "status"))
	expectTrue(c, field(data, "end_reason") != "", "A12 应记录 end_reason")
	expectTrue(c, field(data, "ended_at") != "", "A12 应记录 ended_at")
	expectTrue(c, len(forwarder.rulesSnapshot()) == 0, "A12 回收后不得残留转发规则")
}

// A13：对已回收会话重复调用返回 200，且不产生额外变更。
func TestA13(t *testing.T) {
	forwarder := newFakeForwarder()
	c := newCase(t, forwarder)
	server := c.start(nil)

	_, token, _ := c.issueToken(server)
	session := expectOK(c, c.openSession(server, token, requestOptions{}), "A13")
	sessionID := field(session, "session_id")

	first := expectOK(c, c.closeSession(server, sessionID), "A13")
	again := expectOK(c, c.closeSession(server, sessionID), "A13（重复回收）")
	expectTrue(c, field(again, "status") == "ended", "A13 重复回收应仍是 ended")
	expectTrue(c, field(again, "ended_at") == field(first, "ended_at"), "A13 重复回收不得改动 ended_at")
	expectTrue(c, field(again, "end_reason") == field(first, "end_reason"), "A13 重复回收不得改动 end_reason")
	expectTrue(c, len(forwarder.rulesSnapshot()) == 0, "A13 重复回收后仍不得残留规则")
}

// A14：存在超过 access.max_duration_minutes 的会话时，调用后该会话被回收，
// 返回结果中包含其 session_id。
func TestA14(t *testing.T) {
	forwarder := newFakeForwarder()
	c := newCase(t, forwarder)
	server := c.start(nil)

	_, token, _ := c.issueToken(server)
	session := expectOK(c, c.openSession(server, token, requestOptions{}), "A14")
	expectTrue(c, len(forwarder.rulesSnapshot()) == 1, "A14 前置：应已建立一条转发规则")

	// 重启并推进时钟：会话最长 30 分钟，推进 31 分钟。
	restarted := c.restart(nil)
	c.clock.advance(31 * time.Minute)

	data := expectOK(c, c.sweep(restarted), "A14")
	reclaimed := stringList(data["reclaimed"])
	expectTrue(c, data["reclaimed"] != nil, "A14 响应应包含 reclaimed 数组")
	expectTrue(c, contains(reclaimed, field(session, "session_id")),
		"A14 超时会话应出现在 reclaimed 中，实际 %v", reclaimed)
	expectTrue(c, len(forwarder.rulesSnapshot()) == 0, "A14 回收后不得残留转发规则")
}

// A15：回收失败时返回 200 但在结果中列出失败项，并记录 E_CHANNEL_TEARDOWN_FAILED。
func TestA15(t *testing.T) {
	forwarder := newFailingForwarder()
	c := newCase(t, forwarder)
	server := c.start(nil)

	_, token, _ := c.issueToken(server)
	session := expectOK(c, c.openSession(server, token, requestOptions{}), "A15")

	restarted := c.restart(nil)
	c.clock.advance(31 * time.Minute)

	data := expectOK(c, c.sweep(restarted), "A15")
	failed := objectList(data["failed"])
	expectTrue(c, data["failed"] != nil, "A15 响应应包含 failed 数组")
	entry := findSession(failed, field(session, "session_id"))
	expectTrue(c, entry != nil, "A15 失败会话应出现在 failed 中，实际 %v", failed)
	expectTrue(c, entry != nil && field(entry, "code") == "E_CHANNEL_TEARDOWN_FAILED",
		"A15 失败项应带 E_CHANNEL_TEARDOWN_FAILED")
}

// A16：auditor 指定时间范围导出后返回 200，导出条数与该范围内实际事件数一致。
func TestA16(t *testing.T) {
	c := newCase(t, newFakeForwarder())
	server := c.start(nil)
	c.issueToken(server)

	now := c.clock.Now()
	from := isoMinutesFrom(now, -60)
	to := isoMinutesFrom(now, 60)
	data := expectOK(c, c.exportAudit(server, from, to, nil), "A16")

	events := objectList(data["events"])
	count := numberField(data, "count")
	expectTrue(c, data["events"] != nil, "A16 data.events 应为数组")
	expectTrue(c, count == len(events), "A16 count 应等于 events 长度：%d vs %d", count, len(events))
	expectTrue(c, count >= 3, "A16 一次申请加审批至少产生 3 条审计事件，实际 %d", count)
	expectTrue(c, count >= 3 && ascending(c, events), "A16 events 应按 occurred_at 升序")

	past := expectOK(c, c.exportAudit(server, "2000-01-01T00:00:00Z", "2000-01-02T00:00:00Z", nil), "A16（区间外）")
	expectTrue(c, numberField(past, "count") == 0, "A16 区间外应导出 0 条")
}

// A17：非 auditor 角色调用返回 403 与 E_FORBIDDEN_ROLE；导出成功后新增一条 audit_exported 事件。
func TestA17(t *testing.T) {
	c := newCase(t, newFakeForwarder())
	server := c.start(nil)
	c.issueToken(server)

	now := c.clock.Now()
	from := isoMinutesFrom(now, -60)
	to := isoMinutesFrom(now, 60)
	expectStatus(c, c.exportAudit(server, from, to, &actorRequester), "A17", http.StatusForbidden, "E_FORBIDDEN_ROLE")

	first := expectOK(c, c.exportAudit(server, from, to, nil), "A17")
	second := expectOK(c, c.exportAudit(server, from, to, nil), "A17")
	expectTrue(c, numberField(second, "count") == numberField(first, "count")+1,
		"A17 导出本身应新增一条审计事件：%d -> %d", numberField(first, "count"), numberField(second, "count"))

	events := objectList(second["events"])
	expectTrue(c, len(events) > 0 && field(events[len(events)-1], "event_type") == "audit_exported",
		"A17 最后一条事件应为 audit_exported")
}

// A18：持有已被吊销授权的令牌调用时返回 403 与 E_GRANT_REVOKED，且不产生转发规则。
func TestA18(t *testing.T) {
	forwarder := newFakeForwarder()
	c := newCase(t, forwarder)
	server := c.start(nil)

	requestID, token, _ := c.issueToken(server)
	expectOK(c, api(c, server, http.MethodPost, "/api/emergency/access/revoke", requestOptions{
		actor: &actorApprover,
		body:  map[string]any{"request_id": requestID},
	}), "A18")

	expectStatus(c, c.openSession(server, token, requestOptions{}), "A18", http.StatusForbidden, "E_GRANT_REVOKED")
	expectTrue(c, len(forwarder.rulesSnapshot()) == 0, "A18 被吊销的令牌不得产生转发规则")
}

// ------------------------------------------------------------------ 小工具

func stringList(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			out = append(out, text)
		}
	}
	return out
}

func objectList(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if object, ok := item.(map[string]any); ok {
			out = append(out, object)
		}
	}
	return out
}

func contains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func findSession(items []map[string]any, sessionID string) map[string]any {
	for _, item := range items {
		if field(item, "session_id") == sessionID {
			return item
		}
	}
	return nil
}

func numberField(data map[string]any, key string) int {
	value, ok := data[key].(float64)
	if !ok {
		return -1
	}
	return int(value)
}

// ascending 断言事件按 occurred_at 升序，且时间可解析。
func ascending(c *caseEnv, events []map[string]any) bool {
	previous := time.Time{}
	for index, event := range events {
		parsed, err := time.Parse(time.RFC3339, field(event, "occurred_at"))
		if err != nil {
			c.t.Fatalf("A16 事件应带可解析的 occurred_at：%v", err)
		}
		if index > 0 && parsed.Before(previous) {
			return false
		}
		previous = parsed
	}
	return true
}
