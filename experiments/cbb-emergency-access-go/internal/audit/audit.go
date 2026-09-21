// Package audit 是 audit capability 的实现位置（specs/audit/spec.md）。
//
// 种子阶段只声明接缝；函数体返回 E_NOT_IMPLEMENTED。
package audit

import (
	"net/http"
	"time"

	"cbb-emergency-access/internal/contract"
	"cbb-emergency-access/internal/store"
)

// Deps 是 audit 能力需要的外部依赖。
type Deps struct {
	Store     *store.Store
	Now       contract.Clock
	ExportDir string
}

// Export 按时间范围导出审计事件；导出行为本身也被记录（A17）。
func Export(d Deps, actor contract.Actor, from, to time.Time) contract.Result {
	_, _, _, _ = d, actor, from, to
	return contract.Fail(
		http.StatusNotImplemented,
		"E_NOT_IMPLEMENTED",
		"实现尚未产出（spec 先行的种子项目的预期状态）",
	)
}
