import type { ChangeEvent, ChangeState } from './change-types.js';

export interface ChangeResume {
  name: string;
  phase: ChangeState["phase"];
  archived: boolean;
  blocked: boolean;
  nextEvent: ChangeEvent | null;
  message: string;
}

const NEXT_EVENT: Record<ChangeState["phase"], ChangeEvent> = {
  shape: 'confirm-acceptance',
  build: 'submit-candidate',
  verify: 'verify-pass',
  archive: 'archive-complete',
};

export function resumeChange(state: ChangeState): ChangeResume {
  if (state.archived) {
    return {
      name: state.name,
      phase: state.phase,
      archived: true,
      blocked: false,
      nextEvent: null,
      message: "Change is already archived",
    };
  }
  // 停机的 change 不给下一步 transition：它需要的不是继续跑，而是人的判断。
  if (state.status === 'blocked') {
    return {
      name: state.name,
      phase: state.phase,
      archived: false,
      blocked: true,
      nextEvent: null,
      message:
        'Change is blocked after ' +
        (state.repair_attempts ?? 0) +
        ' repair attempt(s) with the same failing verdict. Read changes/' +
        state.name +
        '/verification.md, fix the cause (spec, acceptance or implementation), then run: cometflow change unblock ' +
        state.name,
    };
  }
  const nextEvent = NEXT_EVENT[state.phase];
  return {
    name: state.name,
    phase: state.phase,
    archived: false,
    blocked: false,
    nextEvent,
    message: "Next action: " + nextEvent,
  };
}
