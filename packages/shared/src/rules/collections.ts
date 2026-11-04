import { addDays, daysBetween } from './businessDays';
import { D, type Numeric } from './common';
import type { CollectionStep, UserRole } from '../enums';
import type { Settings } from '../schemas/settings';

export interface EscalationEntry {
  step: CollectionStep;
  offsetDays: number;
  scheduledOn: string;
  /** i18n key suffix: collections.actions.<step> */
  action: CollectionStep;
  responsibleRoles: UserRole[];
  notifyRoles: UserRole[];
}

/** Who acts and who is informed at each step (source "Escalamiento de cobranza", P8-06). */
export const ESCALATION_RESPONSIBILITY: Record<
  CollectionStep,
  { responsibleRoles: UserRole[]; notifyRoles: UserRole[] }
> = {
  D_MINUS_10: { responsibleRoles: ['ACCOUNT_MANAGER'], notifyRoles: [] },
  D_PLUS_1: { responsibleRoles: ['ACCOUNT_MANAGER'], notifyRoles: ['COUNTRY_MANAGER'] },
  D_PLUS_7: { responsibleRoles: ['COUNTRY_MANAGER'], notifyRoles: ['ACCOUNT_MANAGER'] },
  D_PLUS_15: {
    responsibleRoles: ['COUNTRY_MANAGER'],
    notifyRoles: ['LATAM_PRESIDENT', 'ACCOUNT_MANAGER'],
  },
  D_PLUS_30: {
    responsibleRoles: ['CHINA_FINANCE', 'CHINA_LEGAL'],
    notifyRoles: ['COUNTRY_MANAGER', 'LATAM_PRESIDENT'],
  },
};

const ORDER: CollectionStep[] = ['D_MINUS_10', 'D_PLUS_1', 'D_PLUS_7', 'D_PLUS_15', 'D_PLUS_30'];

/** Escalation schedule in calendar days relative to the invoice due date. */
export function escalationSchedule(
  dueOn: string,
  settings: Pick<Settings, 'collections.offsets'>,
): EscalationEntry[] {
  const offsets = settings['collections.offsets'];
  return ORDER.map((step) => ({
    step,
    offsetDays: offsets[step],
    scheduledOn: addDays(dueOn, offsets[step]),
    action: step,
    ...ESCALATION_RESPONSIBILITY[step],
  }));
}

/**
 * Steps that are due as of `today` and not yet generated. Nothing is due when the balance is 0
 * (P8-06: "pago registrado → no se crean tareas").
 */
export function dueEscalations(
  invoice: { dueOn: string; balance: Numeric },
  today: string,
  existing: ReadonlyArray<CollectionStep>,
  settings: Pick<Settings, 'collections.offsets'>,
): EscalationEntry[] {
  if (D(invoice.balance).lte(0)) return [];
  return escalationSchedule(invoice.dueOn, settings).filter(
    (e) => e.scheduledOn <= today && !existing.includes(e.step),
  );
}

export type AgingBucket = 'CURRENT' | '1-7' | '8-15' | '16-30' | '30+';

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'CURRENT';
  if (daysOverdue <= 7) return '1-7';
  if (daysOverdue <= 15) return '8-15';
  if (daysOverdue <= 30) return '16-30';
  return '30+';
}

export interface EscalationStatus {
  /** Latest step reached as of today, or null if earlier than D−10 or paid. */
  currentStep: CollectionStep | null;
  nextStep: CollectionStep | null;
  nextOn: string | null;
  daysOverdue: number;
  bucket: AgingBucket;
  responsibleRoles: UserRole[];
  notifyRoles: UserRole[];
  paid: boolean;
}

export function escalationStatus(
  invoice: { dueOn: string; balance: Numeric },
  today: string,
  settings: Pick<Settings, 'collections.offsets'>,
): EscalationStatus {
  const paid = D(invoice.balance).lte(0);
  const daysOverdue = paid ? 0 : Math.max(0, daysBetween(invoice.dueOn, today));
  const schedule = escalationSchedule(invoice.dueOn, settings);
  const reached = paid ? [] : schedule.filter((e) => e.scheduledOn <= today);
  const current = reached.at(-1) ?? null;
  const next = paid ? null : (schedule.find((e) => e.scheduledOn > today) ?? null);
  return {
    currentStep: current?.step ?? null,
    nextStep: next?.step ?? null,
    nextOn: next?.scheduledOn ?? null,
    daysOverdue,
    bucket: agingBucket(daysOverdue),
    responsibleRoles: current?.responsibleRoles ?? [],
    notifyRoles: current?.notifyRoles ?? [],
    paid,
  };
}
