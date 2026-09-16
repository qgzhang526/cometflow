export type ChangePhase = 'shape' | 'build' | 'verify' | 'archive';
export type ChangeStatus = 'active' | 'await-user' | 'blocked' | 'done';
export type ChangeEvent = 'confirm-acceptance' | 'submit-candidate' | 'verify-pass' | 'verify-fail' | 'archive-complete';

export interface ChangeState {
  schema: 'cometflow.change.v1';
  name: string;
  goal: string;
  task: string;
  phase: ChangePhase;
  status: ChangeStatus;
  spec_ref: string | null;
  spec_anchor: string | null;
  acceptance_ids: string[];
  spec_version: number | null;
  spec_hash: string | null;
  /**
   * 连续「同一失败结论」的修复轮数。结论发生变化或验证通过时归零/重置，
   * 超过上限就把 change 置为 blocked，停机交还人工。
   */
  repair_attempts?: number;
  /** 上一次失败结论的指纹（只含验收项结论与越界项，不含自由文本理由）。 */
  last_verdict_hash?: string | null;
  /** change 创建时的 git HEAD；用于识别分支漂移与历史回退。 */
  base_commit?: string | null;
  /** change 创建时所在分支（仅用于报告，不参与阻断判定）。 */
  base_branch?: string | null;
  /**
   * change 创建时 canonical spec 的内容哈希。归档前会重新比对，
   * 一旦 canonical spec 在 change 生命周期内被改动，就判定为 spec 冲突，
   * 必须显式 rebase 或重建 change，而不是静默覆盖。
   */
  spec_base_hash?: string | null;
  /** 本 change 归档后产出的 canonical spec 版本号（归档时回写）。 */
  applied_spec_version?: number | null;
  /** anchor 级段落哈希，与 task.anchor_hash 对应。 */
  anchor_hash?: string | null;
  /** 该 change 允许改动/新增代码的模块边界（来自 spec front-matter module）。 */
  module?: string | null;
  /**
   * 来源任务的 capability。spec-authoring 任务没有 spec_ref，提示词要靠它指出
   * 产物应当落在 `specs/<capability>/spec.md`。
   */
  capability?: string | null;
  /**
   * 来源任务的 kind。起草类 change（`spec-authoring`）没有可对照的 acceptance，
   * 验收/归档改看它产出的 spec 是否合格（G4）。
   */
  task_kind?: string | null;
  created_at: string;
  archived: boolean;
  /** 规范化内容哈希；由写入方盖章，用于发现被手工改写的 change 状态。 */
  state_hash?: string;
}
