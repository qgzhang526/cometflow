// 内置的转发器适配器：只维护规则表、不建立真实 SSH 连接。
//
// 这是演练用的实现（specs/constraints.md 允许的默认适配器）；生产部署要用真实转发实现。
// 规则表刻意放在进程内存里并跨会话共享——真实世界里规则活在 SSH 主机上，
// 本服务重启不会让它们消失，这一点在 A14（跨进程重启后回收）里被验到。
//
// 它是接缝的一部分（specs/config.md「接缝」表里的「转发器」一行），所以属于种子，
// 不属于任何 capability 任务。
package tunnel

import (
	"fmt"
	"sync"

	"cbb-emergency-access/internal/contract"
)

type memoryForwarder struct {
	mu    sync.Mutex
	seq   int
	rules map[string]contract.Rule
}

// NewMemoryForwarder 返回演练用的内存转发器。
func NewMemoryForwarder() contract.Forwarder {
	return &memoryForwarder{rules: map[string]contract.Rule{}}
}

func (f *memoryForwarder) Open(spec contract.ForwardSpec) (contract.Rule, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seq++
	rule := contract.Rule{
		ID:         fmt.Sprintf("rule-%d", f.seq),
		SessionID:  spec.SessionID,
		ServerID:   spec.ServerID,
		SourceIP:   spec.SourceIP,
		ListenPort: spec.ListenPort,
	}
	f.rules[rule.ID] = rule
	return rule, nil
}

func (f *memoryForwarder) Close(sessionID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id, rule := range f.rules {
		if rule.SessionID == sessionID {
			delete(f.rules, id)
		}
	}
	return nil
}

func (f *memoryForwarder) List() ([]contract.Rule, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]contract.Rule, 0, len(f.rules))
	for _, rule := range f.rules {
		out = append(out, rule)
	}
	return out, nil
}
