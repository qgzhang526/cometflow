// Package store 是存储层：实体表与 append-only 审计（见 specs/models.md）。
//
// 它属于 specs 里「模块归属」的共享路径：任何 capability 的任务都可以改它，不受模块边界限制。
//
// 种子阶段这里只给类型与构造入口，让整个仓库先能编译、能起来、能被判据判成红的；
// 具体的表与查询由任务按 specs/models.md 补出来。
package store

import "time"

// Store 是存储句柄。真实实现持有 SQLite 连接（见 specs/models.md 与 specs/constraints.md）；
// 种子阶段它是一个空壳，让整个仓库先能编译。
type Store struct{}

// Open 打开（或创建）存储。path 为 ":memory:" 时表示进程内内存库。
func Open(path string, now func() time.Time) (*Store, error) {
	_, _ = path, now
	return &Store{}, nil
}

// Close 释放存储句柄。
func (s *Store) Close() error { return nil }
