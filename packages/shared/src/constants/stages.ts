import type { ProcessCode } from '../enums';

export const STAGES = [
  { n: 0, code: 'LEAD', process: 'P1' },
  { n: 1, code: 'QUALIFIED', process: 'P2' },
  { n: 2, code: 'DISCOVERY', process: 'P3' },
  { n: 3, code: 'SOLUTION', process: 'P3' },
  { n: 4, code: 'PRICE_REQUESTED', process: 'P5' },
  { n: 5, code: 'PROPOSAL_SENT', process: 'P7' },
  { n: 6, code: 'NEGOTIATION', process: 'P7' },
  { n: 7, code: 'WON', process: 'P7' },
  { n: 8, code: 'IN_DELIVERY', process: 'P9' },
  { n: 9, code: 'ACCEPTED', process: 'P8' },
  { n: 10, code: 'INVOICED', process: 'P8' },
  { n: 11, code: 'COLLECTED', process: 'P8' },
] as const satisfies ReadonlyArray<{ n: number; code: string; process: ProcessCode }>;

export type StageNumber = (typeof STAGES)[number]['n'];
export type StageCode = (typeof STAGES)[number]['code'];

export const MIN_STAGE = 0;
export const MAX_STAGE = 11;
/** Stages from which the commercial status is derived from milestones (CORE-06). */
export const DERIVED_STAGES = [9, 10, 11] as const;

export function stageCode(n: number): StageCode {
  const s = STAGES.find((x) => x.n === n);
  if (!s) throw new RangeError(`Invalid stage ${n}`);
  return s.code;
}

/** Processes that own an opportunity at a given stage (visibility, ARCHITECTURE §6.4). */
export function stageProcesses(n: number): ProcessCode[] {
  if (n === 0) return ['P1'];
  if (n === 1) return ['P2'];
  if (n <= 3) return ['P3'];
  if (n === 4) return ['P5'];
  if (n <= 6) return ['P6', 'P7'];
  if (n === 7) return ['P7'];
  if (n === 8) return ['P9'];
  if (n <= 11) return ['P8'];
  throw new RangeError(`Invalid stage ${n}`);
}

/** Process that must hold write (R/A) to move an opportunity INTO a stage. */
export function transitionProcess(toStage: number): ProcessCode {
  if (toStage <= 0) return 'P1';
  if (toStage <= 2) return 'P2';
  if (toStage === 3) return 'P3';
  if (toStage === 4) return 'P5';
  if (toStage <= 7) return 'P7';
  if (toStage === 8) return 'P9';
  return 'P8';
}
