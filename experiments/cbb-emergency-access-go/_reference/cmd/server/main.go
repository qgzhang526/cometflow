// 进程形态入口（specs/protocol.md「服务入口」）。
//
//	go run ./cmd/server --config config.json --port 0
//
// --port 0 表示由系统分配端口，就绪后在 stdout 打印 listening on <port>。
package main

import (
	"flag"
	"fmt"
	"os"

	"cbb-emergency-access/internal/app"
)

func main() {
	configPath := flag.String("config", "", "配置文件绝对路径")
	port := flag.Int("port", 0, "监听端口；0 表示由系统分配")
	flag.Parse()
	if *configPath == "" {
		fmt.Fprintln(os.Stderr, "--config 必填")
		os.Exit(2)
	}
	// 端口通过环境变量传给 app.Run：它同时要处理「先监听再打印」的顺序。
	if *port != 0 {
		_ = os.Setenv("CBB_PORT", fmt.Sprintf("%d", *port))
	}
	if err := app.Run(app.Options{ConfigPath: *configPath}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
