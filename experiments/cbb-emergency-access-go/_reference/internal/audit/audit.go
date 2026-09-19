// Package audit：审计导出（specs/audit/spec.md）。
package audit

import (
	"net/http"
	"time"

	"cbb-emergency-access/internal/contract"
	"cbb-emergency-access/internal/store"
)

type Deps struct {
	Store     *store.Store
	Now       contract.Clock
	ExportDir string
}

// Export 按时间范围导出审计事件；导出行为本身也被记录（A17）。
func Export(d Deps, actor contract.Actor, from, to time.Time) contract.Result {
	if !actor.Has(contract.RoleAuditor) {
		return contract.Fail(http.StatusForbidden, "E_FORBIDDEN_ROLE", "当前角色不允许导出审计")
	}
	events, err := d.Store.EventsBetween(from, to)
	if err != nil {
		return contract.Fail(http.StatusInternalServerError, "E_AUDIT_WRITE_FAILED", err.Error())
	}
	// 先出结果再记「导出」这件事：否则本次导出会把自己算进条数里，前后两次对不上。
	list := make([]map[string]any, 0, len(events))
	for _, event := range events {
		list = append(list, map[string]any{
			"event_type":  event.EventType,
			"actor_id":    event.ActorID,
			"subject":     event.Subject,
			"request_id":  event.RequestID,
			"occurred_at": event.OccurredAt.UTC().Format(time.RFC3339Nano),
			"detail":      event.Detail,
		})
	}
	now := d.Now()
	_ = d.Store.AppendEvent("audit_exported", actor.ID, "", "", from.UTC().Format(time.RFC3339Nano)+".."+to.UTC().Format(time.RFC3339Nano), now)
	return contract.OK(map[string]any{
		"count":      len(list),
		"events":     list,
		"from":       from.UTC().Format(time.RFC3339Nano),
		"to":         to.UTC().Format(time.RFC3339Nano),
		"exported_at": now.UTC().Format(time.RFC3339Nano),
	})
}
