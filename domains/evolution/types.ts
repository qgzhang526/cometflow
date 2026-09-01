export type EvolutionStatus = 'draft' | 'verifying' | 'verified' | 'ready-for-review' | 'rejected';

export interface EvolutionGate {
  name: string;
  command: string;
  args: string[];
}

export interface EvolutionProposal {
  schema: 'cometflow.evolution.v1';
  name: string;
  summary: string;
  risk_plan: string;
  gates: EvolutionGate[];
  status: EvolutionStatus;
  created_at: string;
  updated_at: string;
}
