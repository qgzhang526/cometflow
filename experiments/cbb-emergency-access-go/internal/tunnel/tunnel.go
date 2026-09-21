// Package tunnel 是 tunnel capability 的实现位置（specs/tunnel/spec.md）。
//
// 种子阶段只声明接缝：Deps 与入口签名按契约固定，函数体返回 E_NOT_IMPLEMENTED。
// 转发器适配器（NewMemoryForwarder）是接缝本身，放在同包的 forwarder.go，属于种子。
package tunnel

import (
	"net/http"

	"cbb-emergency-access/internal/contract"
	"cbb-emergency-access/internal/store"
)

// Deps 是 tunnel 能力需要的外部依赖。
type Deps struct {
	Store         *store.Store
	Now           contract.Clock
	Forwarder     contract.Forwarder
	SourceAllowed func(ip string) bool
	TargetOnline  func(serverID string) (exists bool, online bool)
	ListenPort    int
	ForwardToPort int
}

func notImplemented() contract.Result {
	return contract.Fail(
		http.StatusNotImplemented,
		"E_NOT_IMPLEMENTED",
		"实现尚未产出（spec 先行的种子项目的预期状态）",
	)
}

// Open 用一次性令牌换一条临时通道。
func Open(d Deps, actor contract.Actor, sourceIP string, body map[string]any) contract.Result {
	_, _, _, _ = d, actor, sourceIP, body
	return notImplemented()
}

// Close 回收一条通道（幂等）。
func Close(d Deps, actor contract.Actor, body map[string]any) contract.Result {
	_, _, _ = d, actor, body
	return notImplemented()
}
