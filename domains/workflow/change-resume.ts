import type { ChangeEvent, ChangeState } from './change-types.js';

export interface ChangeResume {
  name: string;
  phase: ChangeState["phase"];
  archived: boolean;
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
      nextEvent: null,
      message: "Change is already archived",
    };
  }
  const nextEvent = NEXT_EVENT[state.phase];
  return {
    name: state.name,
    phase: state.phase,
    archived: false,
    nextEvent,
    message: "Next action: " + nextEvent,
  };
}
