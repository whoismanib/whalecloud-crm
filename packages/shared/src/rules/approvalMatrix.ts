import { D, type Numeric, type RuleFailure } from './common';
import { lineMargins, type LineItemInput } from './margins';
import type { ApprovalBand, ApprovalStepKind, NonEconomicCondition, UserRole } from '../enums';
import type { Settings } from '../schemas/settings';

export type ApprovalSettings = Pick<
  Settings,
  | 'approval.thresholds'
  | 'approval.marginBasis'
  | 'margins.targets'
  | 'approval.presidentCoApprovesVpBand'
  | 'approval.nonEconomic'
>;

const BAND_RANK: Record<ApprovalBand, number> = {
  COMMITTEE: 0,
  PRESIDENT: 1,
  VP: 2,
  NOT_QUOTABLE: 3,
};

/**
 * Band for one line item (source "Matriz de aprobación", P6-02):
 * margin ≥ target → COMMITTEE; ≥ president threshold (60 %) → PRESIDENT;
 * ≥ vp threshold (50 %) → VP; else NOT_QUOTABLE.
 */
export function bandForLine(
  margin: Numeric | null,
  target: Numeric,
  thresholds: { president: number; vp: number },
): ApprovalBand {
  if (margin === null) return 'NOT_QUOTABLE';
  const m = D(margin);
  if (m.gte(D(target))) return 'COMMITTEE';
  if (m.gte(thresholds.president)) return 'PRESIDENT';
  if (m.gte(thresholds.vp)) return 'VP';
  return 'NOT_QUOTABLE';
}

export function mostRestrictive(bands: ApprovalBand[]): ApprovalBand {
  return bands.reduce<ApprovalBand>(
    (acc, b) => (BAND_RANK[b] > BAND_RANK[acc] ? b : acc),
    'COMMITTEE',
  );
}

export interface ApprovalStepPlan {
  seq: number;
  kind: ApprovalStepKind;
  assigneeRole: UserRole;
  condition: NonEconomicCondition | null;
  consultedRoles: UserRole[];
  informedRoles: UserRole[];
}

export interface RoutedLine {
  lineNo: number;
  itemType: LineItemInput['itemType'];
  netMargin: string | null;
  contractMargin: string | null;
  targetMargin: string;
  /** Margin used to route (per `approval.marginBasis`). */
  basisMargin: string | null;
  band: ApprovalBand;
}

export interface ApprovalRoute {
  band: ApprovalBand;
  blocked: boolean;
  failures: RuleFailure[];
  lines: RoutedLine[];
  steps: ApprovalStepPlan[];
  conditions: NonEconomicCondition[];
  requiresCompetitiveJustification: boolean;
  requiresBusinessCase: boolean;
  minLineMargin: string | null;
}

/**
 * Routes an approval per line item; the most restrictive line wins (P6-02).
 * Non-economic conditions add one step each, even when margins are on target (P6-03).
 */
export function routeApproval(
  items: LineItemInput[],
  conditions: NonEconomicCondition[],
  settings: ApprovalSettings,
): ApprovalRoute {
  const thresholds = settings['approval.thresholds'];
  const basis = settings['approval.marginBasis'];
  const lines: RoutedLine[] = items.map((item) => {
    const m = lineMargins(item, settings['margins.targets']);
    const basisMargin = basis === 'NET_INCOME' ? m.netMargin : m.contractMargin;
    return { ...m, basisMargin, band: bandForLine(basisMargin, m.targetMargin, thresholds) };
  });
  const failures: RuleFailure[] = [];
  if (lines.length === 0) failures.push({ code: 'LINE_ITEMS_REQUIRED' });
  const band = lines.length ? mostRestrictive(lines.map((l) => l.band)) : 'NOT_QUOTABLE';
  const blocked = band === 'NOT_QUOTABLE';
  if (blocked && lines.length) {
    const low = lines.filter((l) => l.band === 'NOT_QUOTABLE').map((l) => String(l.lineNo));
    failures.push({ code: 'NOT_QUOTABLE_BELOW_50', params: { lines: low } });
  }

  const margins = lines.map((l) => l.basisMargin).filter((m): m is string => m !== null);
  const minLineMargin = margins.length ? margins.reduce((a, b) => (D(b).lt(D(a)) ? b : a)) : null;

  const steps: ApprovalStepPlan[] = [];
  if (!blocked) {
    let seq = 1;
    if (band === 'COMMITTEE') {
      steps.push(step(seq++, 'MARGIN_COMMITTEE', 'CHINA_SALES', null, [], ['COUNTRY_MANAGER']));
    } else if (band === 'PRESIDENT') {
      steps.push(
        step(
          seq++,
          'MARGIN_PRESIDENT',
          'LATAM_PRESIDENT',
          null,
          ['CHINA_SALES'],
          ['VP', 'COUNTRY_MANAGER'],
        ),
      );
    } else if (band === 'VP') {
      const coApproves = settings['approval.presidentCoApprovesVpBand'];
      steps.push(
        step(
          seq++,
          'MARGIN_VP',
          'VP',
          null,
          ['CHINA_FINANCE', 'CHINA_SALES'],
          coApproves ? ['COUNTRY_MANAGER'] : ['LATAM_PRESIDENT', 'COUNTRY_MANAGER'],
        ),
      );
      if (coApproves) {
        steps.push(step(seq++, 'VP_CO_APPROVAL', 'LATAM_PRESIDENT', null, ['CHINA_FINANCE'], []));
      }
    }
    const ne = settings['approval.nonEconomic'];
    for (const c of conditions) {
      steps.push(
        step(seq++, 'NON_ECONOMIC', ne.approverRole, c, [ne.consult[c]], ['COUNTRY_MANAGER']),
      );
    }
  }

  return {
    band,
    blocked,
    failures,
    lines,
    steps,
    conditions,
    requiresCompetitiveJustification: band === 'PRESIDENT',
    requiresBusinessCase: band === 'VP',
    minLineMargin,
  };
}

function step(
  seq: number,
  kind: ApprovalStepKind,
  assigneeRole: UserRole,
  condition: NonEconomicCondition | null,
  consultedRoles: UserRole[],
  informedRoles: UserRole[],
): ApprovalStepPlan {
  return { seq, kind, assigneeRole, condition, consultedRoles, informedRoles };
}

/** Validates the inputs needed to open an approval request (P6-02/P6-03). */
export function validateApprovalRequest(
  route: ApprovalRoute,
  input: { competitiveJustification?: string | null; businessCaseApproved: boolean },
): RuleFailure[] {
  const failures = [...route.failures];
  if (route.blocked) return failures;
  if (route.requiresCompetitiveJustification && !input.competitiveJustification?.trim()) {
    failures.push({ code: 'JUSTIFICATION_REQUIRED' });
  }
  if (route.requiresBusinessCase && !input.businessCaseApproved) {
    failures.push({ code: 'BUSINESS_CASE_REQUIRED' });
  }
  return failures;
}
