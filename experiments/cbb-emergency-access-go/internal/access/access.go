// Package access 是 access capability 的实现位置（specs/access/spec.md）。
//
// 种子阶段只声明接缝：Deps 的形状与四个入口的签名都按契约固定下来，
// 函数体返回 E_NOT_IMPLEMENTED —— 判据因此是红的，但整个仓库能编译、能起服务。
// 任务实现时把函数体换掉即可；该写成什么样，以 specs/access/spec.md 的验收条目为准。
//
// 本包由 specs/access/spec.md 的验收条目判定。实现时按这张对照表逐条对齐，
// 每条都可以单独跑：`go test ./tests/acceptance -run '^TestA1$' -count=1`。
//
//	POST /api/emergency/access/request
//	  A1  合法申请 → 200，生成 status=pending 的申请单，issued 与请求可经 X-Request-Id 关联
//	  A2  duration_minutes 超过 access.max_duration_minutes → 403 E_DURATION_EXCEEDS_LIMIT
//	  A3  来源地址不在 access.allowed_source_cidrs → 403 E_SOURCE_NOT_ALLOWED
//	POST /api/emergency/access/approve
//	  A4  approver 审批通过 → 200，状态 approved，并发放一次性授权
//	  A5  审批人等于申请人 → 403 E_SELF_APPROVAL
//	  A6  对已审批的申请单再次审批 → 409 E_REQUEST_ALREADY_DECIDED
//	POST /api/emergency/access/revoke
//	  A7  approver 吊销 → 200，申请与授权都变 revoked（同一个令牌还能不能建通道，
//	      是 tunnel 的事实，判在 tunnel/spec.md 的 A18：本任务不碰 internal/tunnel）
//	GET /api/emergency/access/status
//	  A8  查询既有申请 → 200，含申请/授权/会话状态，且响应中不出现明文令牌
package access

import (
	"net/http"

	"cbb-emergency-access/internal/contract"
	"cbb-emergency-access/internal/store"
)

// Deps 是 access 能力需要的外部依赖，由 internal/app 组装后注入。
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

func notImplemented() contract.Result {
	return contract.Fail(
		http.StatusNotImplemented,
		"E_NOT_IMPLEMENTED",
		"实现尚未产出（spec 先行的种子项目的预期状态）",
	)
}

// Request 发起一次应急接入申请。
func Request(d Deps, actor contract.Actor, sourceIP string, body map[string]any) contract.Result {
	_, _, _, _ = d, actor, sourceIP, body
	return notImplemented()
}

// Approve 审批一次申请（通过 / 驳回）。
func Approve(d Deps, actor contract.Actor, body map[string]any) contract.Result {
	_, _, _ = d, actor, body
	return notImplemented()
}

// Revoke 强制吊销未结束的申请与授权。
func Revoke(d Deps, actor contract.Actor, body map[string]any) contract.Result {
	_, _, _ = d, actor, body
	return notImplemented()
}

// Status 查询申请单与关联授权、会话的当前状态。
func Status(d Deps, actor contract.Actor, requestID string) contract.Result {
	_, _, _ = d, actor, requestID
	return notImplemented()
}
