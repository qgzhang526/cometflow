// 参考实现：把各 capability 组装成一个服务（模块形态与进程形态共用同一份路由与逻辑）。
//
// 它通过 init() 把 Start/Run 指到真正的实现上；seam.go 里的类型与接口不动。
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"cbb-emergency-access/internal/access"
	"cbb-emergency-access/internal/audit"
	"cbb-emergency-access/internal/contract"
	"cbb-emergency-access/internal/guard"
	"cbb-emergency-access/internal/store"
	"cbb-emergency-access/internal/tunnel"
)

func init() {
	startImpl = start
	runImpl = run
}

type server struct {
	http   *http.Server
	store  *store.Store
	url    string
	port   int
}

func (s *server) URL() string { return s.url }

func (s *server) Close() error {
	if err := s.http.Close(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return s.store.Close()
}

type target struct {
	ServerID     string `json:"server_id"`
	Hostname     string `json:"hostname"`
	MgmtEndpoint string `json:"mgmt_endpoint"`
	SSHPort      int    `json:"ssh_port"`
	Status       string `json:"status"`
}

type runtime struct {
	cfg      Config
	targets  map[string]target
	cidrs    []*net.IPNet
	store    *store.Store
	now      contract.Clock
	forward  contract.Forwarder
	handler  http.Handler
	port     int
}

func start(opt Options) (Server, error) {
	rt, err := newRuntime(opt, 0)
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		_ = rt.store.Close()
		return nil, err
	}
	rt.port = listener.Addr().(*net.TCPAddr).Port
	srv := &http.Server{Handler: rt.handler}
	go func() { _ = srv.Serve(listener) }()
	return &server{
		http:  srv,
		store: rt.store,
		url:   fmt.Sprintf("http://127.0.0.1:%d", rt.port),
		port:  rt.port,
	}, nil
}

func run(opt Options) error {
	port := 0
	if value := os.Getenv("CBB_PORT"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			port = parsed
		}
	}
	rt, err := newRuntime(opt, port)
	if err != nil {
		return err
	}
	defer func() { _ = rt.store.Close() }()

	address := fmt.Sprintf("127.0.0.1:%d", rt.port)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: rt.handler}
	fmt.Printf("listening on %d\n", listener.Addr().(*net.TCPAddr).Port)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func newRuntime(opt Options, port int) (*runtime, error) {
	cfg, err := LoadConfig(opt.ConfigPath)
	if err != nil {
		return nil, err
	}
	now := opt.Now
	if now == nil {
		now = time.Now
	}
	// 配置里的 guard.now 优先级最高：它让「把时间拨到未来」这件事不需要改时钟实现。
	if cfg.Guard.Now != "" {
		fixed, err := time.Parse(time.RFC3339, cfg.Guard.Now)
		if err != nil {
			return nil, fmt.Errorf("guard.now 不是合法的 RFC3339 时间: %w", err)
		}
		now = func() time.Time { return fixed }
	}
	targets, err := loadTargets(cfg.Targets.File)
	if err != nil {
		return nil, err
	}
	cidrs, err := parseCIDRs(cfg.Access.AllowedSourceCIDRs)
	if err != nil {
		return nil, err
	}
	st, err := store.Open(cfg.Store.File, now)
	if err != nil {
		return nil, err
	}
	if port == 0 {
		port = cfg.Tunnel.ListenPort
	}
	forwarder := opt.Forwarder
	if forwarder == nil {
		forwarder = tunnel.NewMemoryForwarder()
	}
	rt := &runtime{cfg: cfg, targets: targets, cidrs: cidrs, store: st, now: now, forward: forwarder, port: port}
	rt.handler = rt.routes()
	return rt, nil
}

func (r *runtime) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/emergency/access/request", func(w http.ResponseWriter, req *http.Request) {
		actor, ok := r.authenticate(w, req)
		if !ok {
			return
		}
		body := readBody(req)
		body["x_request_id"] = req.Header.Get("x-request-id")
		r.write(w, access.Request(r.accessDeps(), actor, r.sourceIP(req), body))
	})
	mux.HandleFunc("POST /api/emergency/access/approve", func(w http.ResponseWriter, req *http.Request) {
		actor, ok := r.authenticate(w, req)
		if !ok {
			return
		}
		r.write(w, access.Approve(r.accessDeps(), actor, readBody(req)))
	})
	mux.HandleFunc("POST /api/emergency/access/revoke", func(w http.ResponseWriter, req *http.Request) {
		actor, ok := r.authenticate(w, req)
		if !ok {
			return
		}
		r.write(w, access.Revoke(r.accessDeps(), actor, readBody(req)))
	})
	mux.HandleFunc("GET /api/emergency/access/status", func(w http.ResponseWriter, req *http.Request) {
		actor, ok := r.authenticate(w, req)
		if !ok {
			return
		}
		r.write(w, access.Status(r.accessDeps(), actor, req.URL.Query().Get("request_id")))
	})
	mux.HandleFunc("POST /api/emergency/tunnel/open", func(w http.ResponseWriter, req *http.Request) {
		actor, ok := r.authenticate(w, req)
		if !ok {
			return
		}
		body := readBody(req)
		body["token"] = req.Header.Get("x-operator-token")
		r.write(w, tunnel.Open(r.tunnelDeps(), actor, r.sourceIP(req), body))
	})
	mux.HandleFunc("POST /api/emergency/tunnel/close", func(w http.ResponseWriter, req *http.Request) {
		actor, ok := r.authenticate(w, req)
		if !ok {
			return
		}
		r.write(w, tunnel.Close(r.tunnelDeps(), actor, readBody(req)))
	})
	mux.HandleFunc("POST /api/emergency/guard/sweep", func(w http.ResponseWriter, req *http.Request) {
		if _, ok := r.authenticate(w, req); !ok {
			return
		}
		r.write(w, guard.Sweep(guard.Deps{
			Store:              r.store,
			Now:                r.now,
			Forwarder:          r.forward,
			MaxDurationMinutes: r.cfg.Access.MaxDurationMinutes,
			TeardownRetries:    r.cfg.Guard.TeardownRetries,
		}))
	})
	mux.HandleFunc("GET /api/emergency/audit/export", func(w http.ResponseWriter, req *http.Request) {
		actor, ok := r.authenticate(w, req)
		if !ok {
			return
		}
		from, errFrom := time.Parse(time.RFC3339, req.URL.Query().Get("from"))
		to, errTo := time.Parse(time.RFC3339, req.URL.Query().Get("to"))
		if errFrom != nil || errTo != nil {
			r.write(w, contract.Fail(http.StatusBadRequest, "E_AUDIT_WRITE_FAILED", "from / to 需要 RFC3339 时间"))
			return
		}
		r.write(w, audit.Export(audit.Deps{Store: r.store, Now: r.now, ExportDir: r.cfg.Audit.ExportDir}, actor, from, to))
	})
	return mux
}

func (r *runtime) accessDeps() access.Deps {
	return access.Deps{
		Store:                 r.store,
		Now:                   r.now,
		MaxDurationMinutes:    r.cfg.Access.MaxDurationMinutes,
		RequireSecondApprover: r.cfg.Access.RequireSecondApprover,
		RejectLimitPerHour:    r.cfg.Access.RejectLimitPerHour,
		CircuitBreakMinutes:   r.cfg.Access.CircuitBreakMinutes,
		SourceAllowed:         r.sourceAllowed,
		TargetExists:          func(serverID string) bool { _, ok := r.targets[serverID]; return ok },
	}
}

func (r *runtime) tunnelDeps() tunnel.Deps {
	return tunnel.Deps{
		Store:         r.store,
		Now:           r.now,
		Forwarder:     r.forward,
		SourceAllowed: r.sourceAllowed,
		TargetOnline: func(serverID string) (bool, bool) {
			target, ok := r.targets[serverID]
			if !ok {
				return false, false
			}
			return true, target.Status == "online"
		},
		ListenPort:    r.port,
		ForwardToPort: r.cfg.Tunnel.ForwardToPort,
	}
}

func (r *runtime) authenticate(w http.ResponseWriter, req *http.Request) (contract.Actor, bool) {
	if r.cfg.Auth.Mode == "platform" {
		// 生产走管理平台会话（Cookie + MFA），这一段是部署方接进来的适配器。
		r.write(w, contract.Fail(http.StatusUnauthorized, "E_AUTH_REQUIRED", "未接入管理平台会话"))
		return contract.Actor{}, false
	}
	actorID := req.Header.Get("x-actor-id")
	if actorID == "" {
		r.write(w, contract.Fail(http.StatusUnauthorized, "E_AUTH_REQUIRED", "缺少调用者身份"))
		return contract.Actor{}, false
	}
	roles := []string{}
	for _, role := range strings.Split(req.Header.Get("x-actor-roles"), ",") {
		if trimmed := strings.TrimSpace(role); trimmed != "" {
			roles = append(roles, trimmed)
		}
	}
	return contract.Actor{ID: actorID, Roles: roles}, true
}

func (r *runtime) write(w http.ResponseWriter, result contract.Result) {
	envelope := map[string]any{"code": result.Code, "message": result.Message, "data": result.Data}
	if result.Code == "0" {
		envelope["message"] = ""
	}
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(result.Status)
	_ = json.NewEncoder(w).Encode(envelope)
}

func (r *runtime) sourceIP(req *http.Request) string {
	forwarded := req.Header.Get("x-forwarded-for")
	if forwarded == "" {
		host, _, err := net.SplitHostPort(req.RemoteAddr)
		if err != nil {
			return req.RemoteAddr
		}
		return host
	}
	// 经代理时取最后一个值（specs/protocol.md）。
	parts := strings.Split(forwarded, ",")
	return strings.TrimSpace(parts[len(parts)-1])
}

func (r *runtime) sourceAllowed(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, cidr := range r.cidrs {
		if cidr.Contains(parsed) {
			return true
		}
	}
	return false
}

func loadTargets(path string) (map[string]target, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取目标清单 %s: %w", path, err)
	}
	var list []target
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("解析目标清单 %s: %w", path, err)
	}
	out := map[string]target{}
	for _, item := range list {
		out[item.ServerID] = item
	}
	return out, nil
}

func parseCIDRs(values []string) ([]*net.IPNet, error) {
	out := make([]*net.IPNet, 0, len(values))
	for _, value := range values {
		_, cidr, err := net.ParseCIDR(value)
		if err != nil {
			return nil, fmt.Errorf("非法网段 %q: %w", value, err)
		}
		out = append(out, cidr)
	}
	return out, nil
}

func readBody(req *http.Request) map[string]any {
	body := map[string]any{}
	if req.Body == nil {
		return body
	}
	_ = json.NewDecoder(req.Body).Decode(&body)
	return body
}
