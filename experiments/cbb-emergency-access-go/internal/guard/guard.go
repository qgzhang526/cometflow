// Package guard 是 guard capability 的实现位置（specs/guard/spec.md）。
//
// 种子阶段只声明接缝；函数体返回 E_NOT_IMPLEMENTED。
package guard

import (
	"net/http"

	"cbb-emergency-access/internal/contract"
	"cbb-emergency-access/internal/store"
)

// Deps 是 guard 能力需要的外部依赖。
type Deps struct {
	Store              *store.Store
	Now                contract.Clock
	Forwarder          contract.Forwarder
	MaxDurationMinutes int
	TeardownRetries    int
}

// Sweep 扫描并按需回收超时会话。
func Sweep(d Deps) contract.Result {
	_ = d
	return contract.Fail(
		http.StatusNotImplemented,
		"E_NOT_IMPLEMENTED",
		"实现尚未产出（spec 先行的种子项目的预期状态）",
	)
}
