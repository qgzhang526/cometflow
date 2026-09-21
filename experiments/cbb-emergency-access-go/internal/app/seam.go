// Package app 是这个 CBB 的接缝层：只声明契约（配置、外部依赖、服务入口），
// 不含业务实现。实现由 Agent 在 change / daemon 通道里产出，落在各自的模块里：
//
//	internal/access  申请、审批、吊销、查询
//	internal/tunnel  通道建立与回收
//	internal/guard   回收扫描
//	internal/audit   审计导出
//	internal/store   存储层（SQLite）与 append-only 审计
//
// 这个文件与 specs/config.md、specs/protocol.md 一一对应：配置键、接缝、服务入口的形态
// 都是契约的一部分，所以它属于种子，而不是实现。
package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"cbb-emergency-access/internal/contract"
)

// ErrNotImplemented 是种子项目的预期状态：契约与判据先写，实现还没产出。
// 验收执行器把带这个错误的失败报成「缺少实现」，而不是当成实现做错了。
var ErrNotImplemented = errors.New("cbb-emergency-access: 实现尚未产出（spec 先行的种子项目的预期状态）")

// 下面这几个是契约包里的类型别名：对外仍然叫 app.Clock / app.Forwarder / app.Rule，
// 但定义在叶子包 internal/contract 里，避免 capability 包与 app 互相引用。
type (
	// Clock 是时钟接缝（specs/config.md 的 guard.now）。
	// 生产传 nil 表示用真实时间；验收注入可推进的假时钟，且它是实现里唯一的时间源。
	Clock = contract.Clock
	// Forwarder 是 SSH 转发器适配器接缝（specs/tunnel/spec.md「转发器适配器」）。
	Forwarder = contract.Forwarder
	// ForwardSpec 是一次转发的输入。
	ForwardSpec = contract.ForwardSpec
	// Rule 是一条转发规则。
	Rule = contract.Rule
)

// Config 是 specs/config.md 的运行时配置；字段与配置键一一对应。
type Config struct {
	Auth struct {
		Mode string `json:"mode"`
	} `json:"auth"`
	Store struct {
		File string `json:"file"`
	} `json:"store"`
	Targets struct {
		File string `json:"file"`
	} `json:"targets"`
	Access struct {
		MaxDurationMinutes    int      `json:"max_duration_minutes"`
		IdleTimeoutMinutes    int      `json:"idle_timeout_minutes"`
		RequireSecondApprover bool     `json:"require_second_approver"`
		AllowedSourceCIDRs    []string `json:"allowed_source_cidrs"`
		RejectLimitPerHour    int      `json:"reject_limit_per_hour"`
		CircuitBreakMinutes   int      `json:"circuit_break_minutes"`
	} `json:"access"`
	Tunnel struct {
		ListenPort    int    `json:"listen_port"`
		ForwardToPort int    `json:"forward_to_port"`
		Forwarder     string `json:"forwarder"`
	} `json:"tunnel"`
	Guard struct {
		TickSeconds     int    `json:"tick_seconds"`
		TeardownRetries int    `json:"teardown_retries"`
		Now             string `json:"now"`
	} `json:"guard"`
	Audit struct {
		ExportDir     string `json:"export_dir"`
		RetentionDays int    `json:"retention_days"`
	} `json:"audit"`
	Alert struct {
		WebhookURL string   `json:"webhook_url"`
		NotifyOn   []string `json:"notify_on"`
	} `json:"alert"`
}

// Options 是服务入口的注入点。
type Options struct {
	// ConfigPath 是配置文件绝对路径。
	ConfigPath string
	// Forwarder 为 nil 时，按 Config.Tunnel.Forwarder 选内置实现。
	Forwarder Forwarder
	// Now 为 nil 时用真实时间；Config.Guard.Now 非空时以它为准。
	Now Clock
}

// Server 是模块形态的服务句柄（specs/protocol.md「服务入口」）。
type Server interface {
	URL() string
	Close() error
}

// LoadConfig 读 JSON 配置；相对路径按进程 cwd 解析（与 specs/config.md 一致）。
func LoadConfig(path string) (Config, error) {
	var cfg Config
	raw, err := os.ReadFile(path)
	if err != nil {
		return cfg, fmt.Errorf("读取配置 %s: %w", path, err)
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, fmt.Errorf("解析配置 %s: %w", path, err)
	}
	return cfg, nil
}

// 实现产出后，由同包里的实现文件把这两个变量指过去。
// 用变量而不是直接调用，是为了让「还没有实现」这件事本身可判定：种子阶段它们都是 nil，
// 验收执行器就会收到 ErrNotImplemented，并把它报成「缺少实现」而不是实现做错了。
var (
	startImpl func(Options) (Server, error)
	runImpl   func(Options) error
)

// Start 起一个进程内服务（模块形态）。验收执行器用它，所以模块形态是判据的一部分。
func Start(opt Options) (Server, error) {
	if startImpl == nil {
		return nil, ErrNotImplemented
	}
	return startImpl(opt)
}

// Run 是进程形态入口（cmd/server/main.go 调用它）：
// 监听就绪后在 stdout 打印 listening on <port>，收到 SIGTERM/SIGINT 时退出码 0。
func Run(opt Options) error {
	if runImpl == nil {
		return ErrNotImplemented
	}
	return runImpl(opt)
}
