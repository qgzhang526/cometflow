export type ChangePhase = 'shape' | 'build' | 'verify' | 'archive';
export type ChangeStatus = 'active' | 'await-user' | 'blocked' | 'done';
export type ChangeEvent = 'confirm-acceptance' | 'submit-candidate' | 'verify-pass' | 'archive-complete';

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
  created_at: string;
  archived: boolean;
}
