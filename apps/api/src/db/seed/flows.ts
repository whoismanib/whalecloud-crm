import type {
  LineItemDto,
  MilestoneTrigger,
  OpportunityCreate,
  SheetVersionCreate,
} from '@wcrm/shared';

/** Minimal HTTP client shape shared by supertest (tests) and app.inject (demo seed). */
export interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON payloads of any endpoint
  body: any;
}
export interface ApiClient {
  get(url: string): PromiseLike<Res>;
  post(url: string, body?: object): PromiseLike<Res>;
  put(url: string, body?: object): PromiseLike<Res>;
  patch(url: string, body?: object): PromiseLike<Res>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON payloads of any endpoint
export async function okData(p: PromiseLike<Res>): Promise<any> {
  const r = await p;
  if (r.status >= 300) {
    throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 800)}`);
  }
  return r.body.data;
}

export const COMPLETE_BANT = {
  bantBudget: 'COMPLETE',
  bantAuthority: 'COMPLETE',
  bantNeed: 'COMPLETE',
  bantTimeline: 'COMPLETE',
} as const;

export function qualification(meddpicc: 'EMPTY' | 'HALF' | 'FULL' = 'HALF') {
  const m = (i: number) =>
    meddpicc === 'FULL' ? 'COMPLETE' : meddpicc === 'HALF' && i < 4 ? 'COMPLETE' : 'EMPTY';
  return {
    ...COMPLETE_BANT,
    mMetrics: m(0),
    mEconomicBuyer: m(1),
    mDecisionCriteria: m(2),
    mDecisionProcess: m(3),
    mPaperProcess: m(4),
    mIdentifyPain: m(5),
    mChampion: m(6),
    mCompetition: m(7),
    notes: {},
  };
}

export function milestonesPct(pcts: number[], triggers: MilestoneTrigger[] = []) {
  const def: MilestoneTrigger[] = ['SIGNATURE', 'SRS_DONE', 'UAT', 'GO_LIVE'];
  return pcts.map((pct, i) => ({
    seq: i + 1,
    pct: String(pct),
    trigger: triggers[i] ?? def[i] ?? 'OTHER',
    triggerText: `${pct}% ${(triggers[i] ?? def[i] ?? 'OTHER').toLowerCase()}`,
  }));
}

/** Line with the given net-income margin (net income = price, no commercial costs). */
export function lineAt(
  lineNo: number,
  itemType: LineItemDto['itemType'],
  price: number,
  margin: number,
  capexOpex: LineItemDto['capexOpex'] = 'CAPEX',
): LineItemDto {
  return {
    lineNo,
    itemType,
    capexOpex,
    cost: (Math.round(price * (1 - margin) * 100) / 100).toFixed(2),
    priceExTax: price.toFixed(2),
    netIncome: price.toFixed(2),
    commercialCosts: '0',
  };
}

export interface OppSetup {
  accountId: string;
  contactId: string;
  oppId: string;
}

/** Account + contact (economic buyer optional) + opportunity at stage 0. */
export async function createOpportunity(
  c: ApiClient,
  p: {
    accountId: string;
    name: string;
    vertical: OpportunityCreate['vertical'];
    engine: OpportunityCreate['billingEngine'];
    amount: string;
    currency?: OpportunityCreate['currency'];
    close: string;
    firstContact: string;
    contact: { firstName: string; lastName: string; jobTitle: string; roles: string[] };
    risk?: 'LOW' | 'MEDIUM' | 'HIGH';
    forecastCategory?: 'COMMIT' | 'PROBABLE' | 'PIPELINE';
    origin?: OpportunityCreate['origin'];
  },
): Promise<OppSetup> {
  const contact = await okData(
    c.post(`/accounts/${p.accountId}/contacts`, {
      firstName: p.contact.firstName,
      lastName: p.contact.lastName,
      jobTitle: p.contact.jobTitle,
      buyingRoles: p.contact.roles,
    }),
  );
  const opp = await okData(
    c.post('/opportunities', {
      name: p.name,
      accountId: p.accountId,
      contactId: contact.id,
      countryCode: 'CL',
      vertical: p.vertical,
      billingEngine: p.engine,
      origin: p.origin ?? 'REFERRAL',
      amount: p.amount,
      currency: p.currency ?? 'USD',
      expectedCloseDate: p.close,
      firstContactDate: p.firstContact,
      risk: p.risk ?? 'LOW',
      forecastCategory: p.forecastCategory ?? 'PIPELINE',
    }),
  );
  return { accountId: p.accountId, contactId: contact.id, oppId: opp.id };
}

/** P2: BANT/MEDDPICC, pain, sponsor, decision criteria/date → stage `to` (≤ 3). */
export async function qualifyTo(
  c: ApiClient,
  s: OppSetup,
  to: 1 | 2 | 3,
  opts: { meddpicc?: 'EMPTY' | 'HALF' | 'FULL'; decisionDate?: string | null } = {},
) {
  await okData(
    c.put(`/opportunities/${s.oppId}/qualification`, qualification(opts.meddpicc ?? 'HALF')),
  );
  const o = await okData(c.get(`/opportunities/${s.oppId}`));
  await okData(
    c.patch(`/opportunities/${s.oppId}`, {
      rowVersion: o.rowVersion,
      pain: 'Plataforma actual sin soporte y costos de operación altos',
      sponsorContactId: s.contactId,
      decisionCriteria: 'TCO a 5 años, referencias en LatAm y plazo de implementación',
      decisionDate: opts.decisionDate === undefined ? '2026-12-10' : opts.decisionDate,
      competitors: ['Huawei', 'Amdocs'],
    }),
  );
  for (let st = 1; st <= to; st++) {
    await okData(c.post(`/opportunities/${s.oppId}/transitions`, { toStage: st }));
  }
}

/** P5: draft + complete A1 + 4 data + expected milestones → submit (opportunity to stage 4). */
export async function submitPriceRequest(
  c: ApiClient,
  s: OppSetup,
  p: { targetPrice: string; expected?: number[]; salesOwnerId?: string } = {
    targetPrice: '1000000',
  },
) {
  const pr = await okData(c.post(`/opportunities/${s.oppId}/price-requests`, { type: 'PROJECT' }));
  await okData(
    c.patch(`/price-requests/${pr.id}`, {
      competitionType: 'TENDER_3_PLUS',
      solutionOwnerName: 'Lin Han',
      deliveryOwnerName: 'I+D y Delivery China',
      projectStageLabel: 'Solución cerrada',
      projectLevel: 'A',
      budget: p.targetPrice,
      budgetCurrency: 'USD',
      signingModel: 'SINGLE_CL_SPA',
      currency: 'USD',
      warrantyMonths: 12,
      summary: 'Implementación llave en mano con soporte L2/L3',
      strategy: 'Precio competitivo en CAPEX, margen en OPEX',
      mainCompetitor: 'Huawei',
      risks: 'Plazo de UAT ajustado; dependencia de integraciones del cliente',
      scopeSummary: 'BRD v2 del cliente; alcance fase 1',
      assumptions: 'Ambientes provistos por el cliente',
      exclusions: 'Hardware y licencias de terceros',
      targetPrice: p.targetPrice,
      targetPriceCurrency: 'USD',
      targetCompetitor: 'Huawei',
    }),
  );
  await okData(
    c.put(
      `/price-requests/${pr.id}/expected-milestones`,
      milestonesPct(p.expected ?? [30, 50, 20]),
    ),
  );
  await okData(c.post(`/price-requests/${pr.id}/submit`));
  return pr.id as string;
}

export async function loadSheet(
  china: ApiClient,
  prId: string,
  p: Partial<SheetVersionCreate> & { lineItems: LineItemDto[] },
) {
  return okData(
    china.post(`/price-requests/${prId}/sheet-versions`, {
      versionLabel: p.versionLabel ?? '1.0',
      currency: p.currency ?? 'USD',
      lineItems: p.lineItems,
      cashflowMilestones: p.cashflowMilestones ?? milestonesPct([30, 50, 20]),
      tcMilestones: p.tcMilestones ?? milestonesPct([30, 50, 20]),
      tcTerms: p.tcTerms ?? { offerValidityDays: 30, paymentTermDays: 45 },
      fileStandardName: p.fileStandardName,
      fileUrl: p.fileUrl,
    }),
  );
}
