// Package guard：回收扫描（specs/guard/spec.md）。
//
// 守卫只做一件事：找出已经超过最长时长的活动会话并回收；回收失败必须显式列出，不能静默。
package guard

import (
	"net/http"
	"time"

	"cbb-emergency-access/internal/contract"
	"cbb-emergency-access/internal/store"
)

type Deps struct {
	Store               *store.Store
	Now                 contract.Clock
	Forwarder           contract.Forwarder
	MaxDurationMinutes  int
	TeardownRetries     int
}

// Sweep 扫描并按需回收超时会话。
func Sweep(d Deps) contract.Result {
	now := d.Now()
	deadline := time.Duration(d.MaxDurationMinutes) * time.Minute

	sessions, err := d.Store.ActiveSessions()
	if err != nil {
		return contract.Fail(http.StatusInternalServerError, "E_CHANNEL_TEARDOWN_FAILED", err.Error())
	}
	reclaimed := []string{}
	failed := []map[string]any{}
	for _, session := range sessions {
		if now.Sub(session.StartedAt) <= deadline {
			continue
		}
		if err := closeWithRetry(d, session.ID); err != nil {
			// 失败要留痕，也要在结果里列出来：静默失败等于没回收。
			_ = d.Store.AppendEvent("session_teardown_failed", "guard", session.ID, "", err.Error(), now)
			failed = append(failed, map[string]any{
				"session_id": session.ID,
				"code":       "E_CHANNEL_TEARDOWN_FAILED",
				"message":    err.Error(),
			})
			continue
		}
		if _, err := d.Store.EndSession(session.ID, "max_duration_exceeded", now); err != nil {
			failed = append(failed, map[string]any{
				"session_id": session.ID,
				"code":       "E_CHANNEL_TEARDOWN_FAILED",
				"message":    err.Error(),
			})
			continue
		}
		_ = d.Store.AppendEvent("session_ended", "guard", session.ID, "", "max_duration_exceeded", now)
		reclaimed = append(reclaimed, session.ID)
	}
	return contract.OK(map[string]any{
		"reclaimed": reclaimed,
		"failed":    failed,
		"checked":   len(sessions),
		"checked_at": now.UTC().Format(time.RFC3339Nano),
	})
}

func closeWithRetry(d Deps, sessionID string) error {
	attempts := d.TeardownRetries
	if attempts < 1 {
		attempts = 1
	}
	var err error
	for i := 0; i < attempts; i++ {
		if err = d.Forwarder.Close(sessionID); err == nil {
			return nil
		}
	}
	return err
}
