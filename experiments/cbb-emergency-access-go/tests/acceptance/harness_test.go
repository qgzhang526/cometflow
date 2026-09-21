package acceptance

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"cbb-emergency-access/internal/app"
)

// 验收执行器的公共部分：造配置、起服务、发请求、断言。
//
// 用法（与 Node 版一致）：
//
//	go test ./tests/acceptance -run '^TestA1$' -count=1   # 单条判据
//	go test ./tests/acceptance -count=1                   # 全部判据
//
// -count=1 不能省：go test 默认会命中测试缓存，同一份代码第二次跑可能直接返回上次的
// PASS，判据就失去意义了。

const (
	onlineServer  = "srv-prod-01"
	allowedSource = "10.1.2.3"
	blockedSource = "203.0.113.7"
	requestIDBase = "req-trace"
)

var (
	actorRequester = actor{"ops-on-call", "requester"}
	actorApprover  = actor{"ops-lead", "approver"}
	actorAuditor   = actor{"sec-auditor", "auditor"}
	actorGuard     = actor{"guard-bot", "guard"}
)

type actor struct {
	id    string
	roles string
}

// ------------------------------------------------------------------ 用例环境

type caseEnv struct {
	t          *testing.T
	dir        string
	stateFile  string
	configPath string
	targets    string
	forwarder  app.Forwarder
	clock      *fakeClock
	servers    []app.Server
	lastError  error
}

func newCase(t *testing.T, forwarder app.Forwarder) *caseEnv {
	t.Helper()
	dir := t.TempDir()
	// go test 的 cwd 是包目录（tests/acceptance），夹具就在它下面。
	// 这里转成绝对路径，免得依赖「实现按 cwd 解析相对路径」这个细节。
	targets, err := filepath.Abs(filepath.Join("testdata", "server-targets.json"))
	if err != nil {
		t.Fatalf("解析夹具路径失败：%v", err)
	}
	env := &caseEnv{
		t:          t,
		dir:        dir,
		stateFile:  filepath.Join(dir, "state.db"),
		configPath: filepath.Join(dir, "config.json"),
		targets:    targets,
		forwarder:  forwarder,
		clock:      newFakeClock(time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC)),
	}
	t.Cleanup(env.stopAll)
	return env
}

// baseConfig 与 Node 版的 baseConfig() 保持同样的键与默认值——
// 配置是契约（specs/config.md），两个语言版本必须给出同一份。
func (c *caseEnv) baseConfig() map[string]any {
	return map[string]any{
		"auth":    map[string]any{"mode": "header"},
		"store":   map[string]any{"file": c.stateFile},
		"targets": map[string]any{"file": c.targets},
		"access": map[string]any{
			"max_duration_minutes":    30,
			"idle_timeout_minutes":    5,
			"require_second_approver": false,
			"allowed_source_cidrs":    []string{"127.0.0.0/8", "10.0.0.0/8"},
			"reject_limit_per_hour":   3,
			"circuit_break_minutes":   30,
		},
		"tunnel": map[string]any{"listen_port": 22022, "forward_to_port": 22, "forwarder": "injected"},
		"guard":  map[string]any{"tick_seconds": 10, "teardown_retries": 1, "now": ""},
		"audit": map[string]any{
			"export_dir":     filepath.Join(c.dir, "export"),
			"retention_days": 180,
		},
		"alert": map[string]any{
			"webhook_url": "http://127.0.0.1:9/unused",
			"notify_on":   []string{"request_created", "request_approved", "channel_opened", "session_ended"},
		},
	}
}

// start 写配置并起一个服务；overrides 深合并进基础配置。
func (c *caseEnv) start(overrides map[string]any) app.Server {
	c.t.Helper()
	merged := deepMerge(c.baseConfig(), overrides)
	raw, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		c.t.Fatalf("序列化配置失败：%v", err)
	}
	if err := os.WriteFile(c.configPath, raw, 0o600); err != nil {
		c.t.Fatalf("写配置失败：%v", err)
	}

	server, err := app.Start(app.Options{
		ConfigPath: c.configPath,
		Forwarder:  c.forwarder,
		Now:        c.clock.Now,
	})
	if err != nil {
		c.lastError = err
		if errors.Is(err, app.ErrNotImplemented) {
			c.t.Fatalf("缺少实现：internal/ 下还没有产出实现（spec 先行的种子项目的预期状态）")
		}
		c.t.Fatalf("启动服务失败：%v", err)
	}
	if server == nil || server.URL() == "" {
		c.t.Fatalf("app.Start 必须返回带 URL 的服务句柄（specs/protocol.md 的模块形态）")
	}
	c.servers = append(c.servers, server)
	return server
}

// restart 关掉所有服务，再用同一份配置与同一个存储文件起一个新的。
// A14 要验「跨进程重启」：守卫的状态必须落盘，不能只活在内存里。
func (c *caseEnv) restart(overrides map[string]any) app.Server {
	c.t.Helper()
	c.stopAll()
	return c.start(overrides)
}

func (c *caseEnv) stopAll() {
	for len(c.servers) > 0 {
		server := c.servers[len(c.servers)-1]
		c.servers = c.servers[:len(c.servers)-1]
		// 关闭失败不影响判据：下一次 start 用的是同一个 SQLite 文件。
		_ = server.Close()
	}
}

func deepMerge(base, patch map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range base {
		out[key] = value
	}
	for key, value := range patch {
		child, childOK := value.(map[string]any)
		current, currentOK := out[key].(map[string]any)
		if childOK && currentOK {
			out[key] = deepMerge(current, child)
			continue
		}
		out[key] = value
	}
	return out
}

// ------------------------------------------------------------------ HTTP 调用

type response struct {
	status int
	body   map[string]any
	text   string
}

type requestOptions struct {
	actor        *actor
	token        string
	forwardedFor string
	requestID    string
	body         map[string]any
}

func api(c *caseEnv, server app.Server, method, path string, opt requestOptions) response {
	c.t.Helper()
	var reader io.Reader
	if opt.body != nil {
		raw, err := json.Marshal(opt.body)
		if err != nil {
			c.t.Fatalf("序列化请求体失败：%v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, server.URL()+path, reader)
	if err != nil {
		c.t.Fatalf("构造请求失败：%v", err)
	}
	requestID := opt.requestID
	if requestID == "" {
		requestID = requestIDBase
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-request-id", requestID)
	if opt.actor != nil {
		req.Header.Set("x-actor-id", opt.actor.id)
		req.Header.Set("x-actor-roles", opt.actor.roles)
	}
	if opt.token != "" {
		req.Header.Set("x-operator-token", opt.token)
	}
	forwardedFor := opt.forwardedFor
	if forwardedFor == "" {
		forwardedFor = allowedSource
	}
	req.Header.Set("x-forwarded-for", forwardedFor)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("请求 %s %s 失败：%v", method, path, err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		c.t.Fatalf("读响应失败：%v", err)
	}
	parsed := map[string]any{}
	_ = json.Unmarshal(raw, &parsed)
	return response{status: res.StatusCode, body: parsed, text: string(raw)}
}

// ------------------------------------------------------------------ 断言辅助

func expectStatus(c *caseEnv, res response, id string, status int, code string) {
	c.t.Helper()
	actual, _ := res.body["code"].(string)
	if res.status != status || actual != code {
		c.t.Fatalf("%s 期望 HTTP %d + code %q，实际 HTTP %d + code %q（%s）",
			id, status, code, res.status, actual, truncate(res.text))
	}
}

func expectOK(c *caseEnv, res response, id string) map[string]any {
	c.t.Helper()
	expectStatus(c, res, id, http.StatusOK, "0")
	data, ok := res.body["data"].(map[string]any)
	if !ok {
		c.t.Fatalf("%s 成功响应缺少 data 对象（%s）", id, truncate(res.text))
	}
	return data
}

func expectTrue(c *caseEnv, condition bool, format string, args ...any) {
	c.t.Helper()
	if !condition {
		c.t.Fatalf(format, args...)
	}
}

func field(data map[string]any, key string) string {
	value, _ := data[key].(string)
	return value
}

func object(data map[string]any, key string) map[string]any {
	value, _ := data[key].(map[string]any)
	return value
}

func truncate(text string) string {
	if len(text) <= 200 {
		return text
	}
	return text[:200]
}

// ------------------------------------------------------------------ 流程辅助

func (c *caseEnv) createRequest(server app.Server, body map[string]any) response {
	c.t.Helper()
	payload := map[string]any{
		"server_id":        onlineServer,
		"reason":           "INC-1001 紧急排障",
		"duration_minutes": 10,
	}
	for key, value := range body {
		payload[key] = value
	}
	return api(c, server, http.MethodPost, "/api/emergency/access/request", requestOptions{
		actor: &actorRequester,
		body:  payload,
	})
}

func (c *caseEnv) approveRequest(server app.Server, requestID string, overrides map[string]any) response {
	c.t.Helper()
	payload := map[string]any{
		"request_id": requestID,
		"decision":   "approve",
		"comment":    "已核对工单",
	}
	for key, value := range overrides {
		payload[key] = value
	}
	return api(c, server, http.MethodPost, "/api/emergency/access/approve", requestOptions{
		actor: &actorApprover,
		body:  payload,
	})
}

// issueToken 走完「申请 → 审批」，返回一次性令牌及其关联对象。
func (c *caseEnv) issueToken(server app.Server) (string, string, map[string]any) {
	c.t.Helper()
	created := expectOK(c, c.createRequest(server, nil), "flow")
	requestID := field(created, "request_id")
	approved := expectOK(c, c.approveRequest(server, requestID, nil), "flow")
	grant := object(approved, "grant")
	return requestID, field(grant, "token"), grant
}

func (c *caseEnv) openSession(server app.Server, token string, opt requestOptions) response {
	c.t.Helper()
	opt.body = map[string]any{"server_id": onlineServer}
	opt.actor = &actorRequester
	opt.token = token
	return api(c, server, http.MethodPost, "/api/emergency/tunnel/open", opt)
}

func (c *caseEnv) closeSession(server app.Server, sessionID string) response {
	c.t.Helper()
	return api(c, server, http.MethodPost, "/api/emergency/tunnel/close", requestOptions{
		actor: &actorRequester,
		body:  map[string]any{"session_id": sessionID},
	})
}

func (c *caseEnv) sweep(server app.Server) response {
	c.t.Helper()
	return api(c, server, http.MethodPost, "/api/emergency/guard/sweep", requestOptions{
		actor: &actorGuard,
		body:  map[string]any{},
	})
}

func (c *caseEnv) exportAudit(server app.Server, from, to string, who *actor) response {
	c.t.Helper()
	if who == nil {
		who = &actorAuditor
	}
	path := fmt.Sprintf("/api/emergency/audit/export?from=%s&to=%s", from, to)
	return api(c, server, http.MethodGet, path, requestOptions{actor: who})
}

// ------------------------------------------------------------------ 假时钟

type fakeClock struct {
	now time.Time
}

func newFakeClock(start time.Time) *fakeClock {
	return &fakeClock{now: start}
}

func (c *fakeClock) Now() time.Time {
	return c.now
}

func (c *fakeClock) advance(d time.Duration) {
	c.now = c.now.Add(d)
}

func (c *fakeClock) iso() string {
	return c.now.UTC().Format(time.RFC3339)
}

func isoMinutesFrom(now time.Time, minutes int) string {
	return now.Add(time.Duration(minutes) * time.Minute).UTC().Format(time.RFC3339)
}
