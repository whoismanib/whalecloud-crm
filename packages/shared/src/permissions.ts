import { stageProcesses } from './constants/stages';
import type { ProcessCode, RaciLetter, UserRole } from './enums';

export type Action = 'view' | 'comment' | 'write' | 'approve' | 'notify';
export type Raci = Partial<Record<ProcessCode, Partial<Record<UserRole, RaciLetter[]>>>>;

const LETTER_ACTIONS: Record<RaciLetter, Action[]> = {
  R: ['view', 'comment', 'write'],
  A: ['view', 'comment', 'write', 'approve', 'notify'],
  C: ['view', 'comment'],
  I: ['view', 'notify'],
};

/** Default RACI v1 (ARCHITECTURE §6.3). Cells are letter lists; empty = "—". */
const r = (s: string): RaciLetter[] => (s === '-' ? [] : (s.split('/') as RaciLetter[]));
const ROLE_ORDER: UserRole[] = [
  'COUNTRY_MANAGER',
  'ACCOUNT_MANAGER',
  'CHINA_SALES',
  'CHINA_DELIVERY',
  'LOCAL_DELIVERY',
  'CHINA_FINANCE',
  'CHINA_LEGAL',
  'VP',
  'LATAM_PRESIDENT',
  'ADMIN',
];
const MATRIX: Record<ProcessCode, string> = {
  P1: 'A R C - - - - - I C',
  P2: 'A R C - - - - - I C',
  P3: 'A R R C C - C - I C',
  P4: 'A R C C - C - - - C',
  P5: 'C R R R C C - I I C',
  P6: 'C R C - - C - A A C',
  P7: 'A R C C - C R - I C',
  P8: 'A R C C R R C - I C',
  P9: 'A R C R R I - - - C',
  P10: 'A R C C C I - - I C',
  P11: 'A R R C C I - - - C',
  P12: 'R/A R C - - C - I I C',
  P13: 'A R C - - C C - I C',
  P14: 'A R C - - - R - I C',
  P15: 'R/A C C - - - - - I C',
  P16: 'A R - - R I - - - C',
  DASH: 'A R I I I I I I I C',
  ADM: 'C - - - - - - - - R/A',
};

export const DEFAULT_RACI: Raci = Object.fromEntries(
  Object.entries(MATRIX).map(([proc, row]) => {
    const cells = row.split(' ');
    return [proc, Object.fromEntries(ROLE_ORDER.map((role, i) => [role, r(cells[i] ?? '-')]))];
  }),
) as Raci;

export function lettersFor(
  roles: readonly UserRole[],
  process: ProcessCode,
  raci: Raci,
): RaciLetter[] {
  const set = new Set<RaciLetter>();
  for (const role of roles) for (const l of raci[process]?.[role] ?? []) set.add(l);
  return [...set];
}

/** R → view/comment/write; A → + approve/notify; C → view/comment; I → view/notify. Union of roles. */
export function can(
  roles: readonly UserRole[],
  process: ProcessCode,
  action: Action,
  raci: Raci = DEFAULT_RACI,
): boolean {
  return lettersFor(roles, process, raci).some((l) => LETTER_ACTIONS[l].includes(action));
}

/** Extra per-action role restrictions on top of the RACI letter (ARCHITECTURE §6.4). */
export const ACTION_ROLES = {
  'P5.a1.write': ['ACCOUNT_MANAGER', 'COUNTRY_MANAGER'],
  'P5.submit': ['ACCOUNT_MANAGER', 'COUNTRY_MANAGER'],
  'P5.status': ['CHINA_SALES'],
  'P5.costEstimate.write': ['CHINA_DELIVERY', 'CHINA_SALES'],
  'P5.sheetVersion.write': ['CHINA_SALES'],
  'P6.committee.record': ['CHINA_SALES'],
  'P7.legalReview.decide': ['CHINA_LEGAL'],
  'P8.evidence.write': ['ACCOUNT_MANAGER', 'LOCAL_DELIVERY'],
  'P8.milestone.ready': ['ACCOUNT_MANAGER', 'LOCAL_DELIVERY'],
  'P8.sendToFinance': ['ACCOUNT_MANAGER'],
  'P8.invoice.write': ['CHINA_FINANCE'],
  'P8.payment.write': ['CHINA_FINANCE'],
  'P8.suspendAccount': ['COUNTRY_MANAGER'],
  'P4.financeComment': ['CHINA_FINANCE'],
  'FX.write': ['CHINA_FINANCE', 'ADMIN'],
} as const satisfies Record<string, readonly UserRole[]>;
export type ActionKey = keyof typeof ACTION_ROLES;

export function hasActionRole(roles: readonly UserRole[], action: ActionKey): boolean {
  return (ACTION_ROLES[action] as readonly UserRole[]).some((r2) => roles.includes(r2));
}

/** Roles that see every country (ARCHITECTURE §6.4). */
export const GLOBAL_COUNTRY_ROLES: UserRole[] = [
  'CHINA_SALES',
  'CHINA_DELIVERY',
  'CHINA_FINANCE',
  'CHINA_LEGAL',
  'VP',
  'LATAM_PRESIDENT',
  'ADMIN',
];

/** Stages (0–11) whose owning process grants the user at least one letter. */
export function visibleStages(roles: readonly UserRole[], raci: Raci = DEFAULT_RACI): number[] {
  const out: number[] = [];
  for (let s = 0; s <= 11; s++) {
    if (stageProcesses(s).some((p) => lettersFor(roles, p, raci).length > 0)) out.push(s);
  }
  return out;
}

/** ADM-02: Legal (— in P1) cannot see a stage-0 opportunity unless explicitly assigned. */
export function canViewOpportunity(
  roles: readonly UserRole[],
  opp: { stage: number; countryCode: string },
  user: { countryCodes: readonly string[]; assigned?: boolean },
  raci: Raci = DEFAULT_RACI,
): boolean {
  if (user.assigned) return true;
  const countryOk =
    user.countryCodes.includes('*') ||
    user.countryCodes.includes(opp.countryCode) ||
    roles.some((r2) => GLOBAL_COUNTRY_ROLES.includes(r2));
  return countryOk && visibleStages(roles, raci).includes(opp.stage);
}
