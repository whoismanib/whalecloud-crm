import type { Page } from '@playwright/test';
import {
  A1_COMPLETE,
  apiOf,
  data,
  login,
  milestonesPct,
  qualification,
  todayCl,
  uniq,
} from './helpers';

export interface Setup {
  accountId: string;
  contactId: string;
  oppId: string;
  name: string;
}

/** API setup (as AM): new account + contact + opportunity at stage 0. */
export async function newOpportunity(
  page: Page,
  p: { amount: string; economicBuyer?: boolean; engine?: string; name?: string },
): Promise<Setup> {
  const api = await apiOf(page);
  const cat = await data(api.get('/catalogs'));
  const entity = cat.billingEntities.find((b: { code: string }) => b.code === 'WC_CL_SPA');
  const acc = await data(
    api.post('/accounts', {
      name: uniq('E2E Cuenta'),
      countryCode: 'CL',
      vertical: 'TELECOM_OSS',
      customerType: 'NEW',
      defaultBillingEntityId: entity.id,
      currency: 'USD',
    }),
  );
  const contact = await data(
    api.post(`/accounts/${acc.id}/contacts`, {
      firstName: 'Rosa',
      lastName: 'Díaz',
      jobTitle: 'Gerente General',
      buyingRoles: p.economicBuyer === false ? ['CHAMPION'] : ['ECONOMIC_BUYER'],
    }),
  );
  const name = p.name ?? uniq('E2E Oportunidad');
  const opp = await data(
    api.post('/opportunities', {
      name,
      accountId: acc.id,
      contactId: contact.id,
      countryCode: 'CL',
      vertical: 'TELECOM_OSS',
      billingEngine: p.engine ?? 'A',
      origin: 'REFERRAL',
      amount: p.amount,
      currency: 'USD',
      expectedCloseDate: todayCl(45),
      firstContactDate: todayCl(),
    }),
  );
  return { accountId: acc.id, contactId: contact.id, oppId: opp.id, name };
}

/** BANT/MEDDPICC + pain, sponsor, criteria, decision date; then transitions up to `to`. */
export async function qualifyTo(page: Page, s: Setup, to: number, meddpicc = 4) {
  const api = await apiOf(page);
  await data(api.put(`/opportunities/${s.oppId}/qualification`, qualification(meddpicc)));
  const o = await data(api.get(`/opportunities/${s.oppId}`));
  await data(
    api.patch(`/opportunities/${s.oppId}`, {
      rowVersion: o.rowVersion,
      pain: 'Plataforma sin soporte',
      sponsorContactId: s.contactId,
      decisionCriteria: 'TCO a 5 años y referencias',
      decisionDate: todayCl(30),
    }),
  );
  for (let st = 1; st <= to; st++) {
    await data(api.post(`/opportunities/${s.oppId}/transitions`, { toStage: st }));
  }
}

/** P5: complete A1 + 4 data, submit (stage 4). Returns the price request id. */
export async function submitPriceRequest(page: Page, s: Setup, targetPrice: string, pcts = [100]) {
  const api = await apiOf(page);
  const pr = await data(api.post(`/opportunities/${s.oppId}/price-requests`, { type: 'PROJECT' }));
  await data(api.patch(`/price-requests/${pr.id}`, A1_COMPLETE(targetPrice)));
  await data(api.put(`/price-requests/${pr.id}/expected-milestones`, milestonesPct(pcts)));
  await data(api.post(`/price-requests/${pr.id}/submit`));
  return pr.id as string;
}

/** Logs in as China Sales and loads a sheet version; logs back in as `back`. */
export async function loadSheet(
  page: Page,
  prId: string,
  lineItems: unknown[],
  opts: { cashflow?: number[]; tc?: number[]; paymentTermDays?: number; label?: string } = {},
) {
  await login(page, 'lin');
  const sheet = await data(
    (await apiOf(page)).post(`/price-requests/${prId}/sheet-versions`, {
      versionLabel: opts.label ?? '1.0',
      currency: 'USD',
      lineItems,
      cashflowMilestones: milestonesPct(opts.cashflow ?? [100]),
      tcMilestones: milestonesPct(opts.tc ?? [100]),
      tcTerms: { offerValidityDays: 30, paymentTermDays: opts.paymentTermDays ?? 45 },
    }),
  );
  return sheet as { id: string; proposedBand: string; netMargin: string };
}

/** P4: business case with TCO horizon, submitted by the AM and approved by the CM. */
export async function approvedBusinessCase(page: Page, oppId: string) {
  await login(page, 'am');
  const am = await apiOf(page);
  const bc = await data(
    am.post(`/opportunities/${oppId}/business-cases`, {
      pain: 'Fibra sin aseguramiento',
      baselineMetric: 'MTTR 12 h',
      benefit: 'MTTR 4 h',
      tcoHorizonYears: 5,
      tco: '3500000',
      tcoCurrency: 'USD',
      risks: 'Integración con inventario',
      strategicValue: 'Cliente nuevo',
    }),
  );
  await data(am.post(`/business-cases/${bc.id}/submit`));
  await login(page, 'cm');
  await data(
    (await apiOf(page)).post(`/business-cases/${bc.id}/decision`, { decision: 'APPROVED' }),
  );
  return bc.id as string;
}
