// Package contract 放跨 capability 共享的契约类型：接缝接口、角色、统一返回。
//
// 它是最底层的叶子包，capability 包（access / tunnel / guard / audit）只依赖它，
// 不依赖 internal/app——这样 app 才能反过来把各 capability 组装起来，不会形成循环依赖。
// internal/app 用类型别名把这里的类型暴露成 app.Forwarder / app.Rule 之类的名字（见 seam.go）。
package contract

import (
	"net/http"
	"time"
)

// Clock 是时钟接缝。实现里所有时间都要走它。
type Clock func() time.Time

// ForwardSpec 是一次转发的输入。
type ForwardSpec struct {
	SessionID     string
	ServerID      string
	SourceIP      string
	ListenPort    int
	ForwardToPort int
}

// Rule 是一条转发规则；真实实现里它活在 SSH 主机上，不随本服务重启消失。
type Rule struct {
	ID         string
	SessionID  string
	ServerID   string
	SourceIP   string
	ListenPort int
}

// Forwarder 是转发器适配器接缝（specs/tunnel/spec.md「转发器适配器」）。
type Forwarder interface {
	Open(spec ForwardSpec) (Rule, error)
	Close(sessionID string) error
	List() ([]Rule, error)
}

// 角色（specs/permissions.md）。
const (
	RoleRequester = "requester"
	RoleApprover  = "approver"
	RoleAuditor   = "auditor"
	RoleGuard     = "guard"
)

type Actor struct {
	ID    string
	Roles []string
}

func (a Actor) Has(role string) bool {
	for _, candidate := range a.Roles {
		if candidate == role {
			return true
		}
	}
	return false
}

// Result 是 capability 的统一返回：状态码 + 错误码（成功为 "0"）+ 数据。
// 响应包络由 internal/app 统一序列化，capability 只回答「什么结果」。
type Result struct {
	Status  int
	Code    string
	Message string
	Data    any
}

func OK(data any) Result {
	return Result{Status: http.StatusOK, Code: "0", Data: data}
}

func Fail(status int, code, message string) Result {
	return Result{Status: status, Code: code, Message: message, Data: map[string]any{}}
}
