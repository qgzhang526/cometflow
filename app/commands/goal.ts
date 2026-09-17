import path from 'node:path';
import { syncGoals } from '../../domains/goal/goal-sync.js';
import { formatScheduleOrder } from '../../domains/goal/schedule-order.js';

export async function goalSyncCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await syncGoals(projectRoot);
  if (result.written.length === 0) {
    console.log('No goals found in COMETFLOW.md');
    return;
  }
  for (const filePath of result.written) {
    console.log('wrote ' + filePath);
  }
  /**
   * 调度顺序（ADR 0029）：写在 COMETFLOW.md 的 `## 调度顺序` 里，**位置即顺序**。
   * 这里把它回显出来，是为了让"我改了顺序但没生效"这类误解当场露头——
   * 顺序由调度器直接读 COMETFLOW.md，不需要重新 sync。
   */
  console.log('调度顺序：' + formatScheduleOrder(result.order));
  for (const warning of result.order.warnings) console.log('警告：' + warning);
}
