export type ClassicPhase = 'open' | 'design' | 'build' | 'verify' | 'archive';
export type ClassicProfile = 'full' | 'hotfix' | 'tweak';
export type ClassicEvent = 'open-complete' | 'design-complete' | 'build-complete' | 'verify-pass' | 'verify-fail' | 'archive-complete';

export interface ClassicState {
  schema: 'cometflow.classic.v1';
  name: string;
  goal: string;
  task: string;
  profile: ClassicProfile;
  phase: ClassicPhase;
  archived: boolean;
  created_at: string;
}
