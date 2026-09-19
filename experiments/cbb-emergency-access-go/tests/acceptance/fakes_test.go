package acceptance

import (
	"errors"
	"fmt"
	"sync"

	"cbb-emergency-access/internal/app"
)

// fakeForwarder 是转发器适配器的验收替身（对应 Node 版的 tests/fixtures/fake-forwarder.mjs）。
//
// 它只维护规则表、不建立真实 SSH 连接。规则表挂在实例上而不是包级变量：
// 跨 Start 实例共享同一份状态是刻意的——真实世界里规则活在 SSH 主机上，
// 本服务重启不会让它们消失（A14 要验的就是这件事）。
type fakeForwarder struct {
	mu     sync.Mutex
	seq    int
	rules  map[string]app.Rule
	closed int
}

func newFakeForwarder() *fakeForwarder {
	return &fakeForwarder{rules: map[string]app.Rule{}}
}

func (f *fakeForwarder) Open(spec app.ForwardSpec) (app.Rule, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seq++
	rule := app.Rule{
		ID:         fmt.Sprintf("rule-%d", f.seq),
		SessionID:  spec.SessionID,
		ServerID:   spec.ServerID,
		SourceIP:   spec.SourceIP,
		ListenPort: spec.ListenPort,
	}
	f.rules[rule.ID] = rule
	return rule, nil
}

func (f *fakeForwarder) Close(sessionID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed++
	for id, rule := range f.rules {
		if rule.SessionID == sessionID {
			delete(f.rules, id)
		}
	}
	return nil
}

func (f *fakeForwarder) List() ([]app.Rule, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]app.Rule, 0, len(f.rules))
	for _, rule := range f.rules {
		out = append(out, rule)
	}
	return out, nil
}

// reset 让每条用例从干净的规则表开始（对应 Node 版的 __reset）。
func (f *fakeForwarder) reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rules = map[string]app.Rule{}
	f.seq = 0
	f.closed = 0
}

// rules 返回规则明细，用于断言「不产生任何转发规则」（对应 Node 版的 __rules）。
func (f *fakeForwarder) rulesSnapshot() []app.Rule {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]app.Rule, 0, len(f.rules))
	for _, rule := range f.rules {
		out = append(out, rule)
	}
	return out
}

// failingForwarder 是异常替身（对应 Node 版的 tests/fixtures/failing-forwarder.mjs）：
// open 正常、close 一定失败。用于验收「回收失败不允许静默失败」（A15）。
type failingForwarder struct {
	*fakeForwarder
	reason error
}

func newFailingForwarder() *failingForwarder {
	return &failingForwarder{
		fakeForwarder: newFakeForwarder(),
		reason:        errors.New("forwarder teardown failed (failing-forwarder fixture)"),
	}
}

func (f *failingForwarder) Close(string) error {
	return f.reason
}
