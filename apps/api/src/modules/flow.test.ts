import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp, uniq } from '../../test/helpers';
import {
  approveCompliance,
  createOpportunity,
  HANDOFF_CHECKLIST_OK,
  lineAt,
  loadSheet,
  milestonesPct,
  okData,
  qualifyTo,
  submitPriceRequest,
  type ApiClient,
  type OppSetup,
} from '../db/seed/flows';

let app: FastifyInstance;
let am: ApiClient;
let cm: ApiClient;
let china: ApiClient;
let president: ApiClient;
let vp: ApiClient;
let finance: ApiClient;
let legal: ApiClient;
let entityId: string;
let localDeliveryId: string;
let chinaDeliveryId: string;

const codes = (r: { body: { errors?: { code: string }[] } }) =>
  (r.body.errors ?? []).map((e) => e.code);

async function setupAt3(amount: string, name = uniq('Opp ')): Promise<OppSetup> {
  const acc = await okData(
    am.post('/accounts', {
      name: uniq('Cuenta '),
      countryCode: 'CL',
      vertical: 'TELECOM_OSS',
      customerType: 'NEW',
      defaultBillingEntityId: entityId,
      currency: 'USD',
    }),
  );
  const s = await createOpportunity(am, {
    accountId: acc.id,
    name,
    vertical: 'TELECOM_OSS',
    engine: 'A',
    amount,
    close: '2026-12-15',
    firstContact: '2026-11-02',
    contact: {
      firstName: 'Rosa',
      lastName: 'Díaz',
      jobTitle: 'Gerente General',
      roles: ['ECONOMIC_BUYER'],
    },
  });
  await qualifyTo(am, s, 3);
  return s;
}

beforeAll(async () => {
  app = await createTestApp();
  am = client(app, await as(app, ['ACCOUNT_MANAGER']));
  cm = client(app, await as(app, ['COUNTRY_MANAGER']));
  china = client(app, await as(app, ['CHINA_SALES'], { countryCodes: ['*'] }));
  president = client(app, await as(app, ['LATAM_PRESIDENT']));
  vp = client(app, await as(app, ['VP']));
  finance = client(app, await as(app, ['CHINA_FINANCE']));
  legal = client(app, await as(app, ['CHINA_LEGAL'], { countryCodes: ['*'] }));
  const ld = await as(app, ['LOCAL_DELIVERY']);
  const cd = await as(app, ['CHINA_DELIVERY']);
  localDeliveryId = ld.userId;
  chinaDeliveryId = cd.userId;
  entityId = (await okData(am.get('/catalogs'))).billingEntities.find(
    (b: { code: string }) => b.code === 'WC_CL_SPA',
  ).id;
});
afterAll(async () => {
  await app.close();
});

describe('P5 price request (A1 + 4 data)', () => {
  it('blocks submit with incomplete A1 and milestones ≠ 100 %', async () => {
    const s = await setupAt3('400000');
    const pr = await okData(am.post(`/opportunities/${s.oppId}/price-requests`, {}));
    const bad = await am.put(
      `/price-requests/${pr.id}/expected-milestones`,
      milestonesPct([30, 50]),
    );
    expect(bad.status).toBe(422);
    expect(codes(bad)).toEqual(['MILESTONES_NOT_100']);
    const r = await am.post(`/price-requests/${pr.id}/submit`);
    expect(r.status).toBe(422);
    expect(codes(r)).toEqual(
      expect.arrayContaining([
        'A1_INCOMPLETE',
        'SCOPE_REQUIRED',
        'TARGET_PRICE_REQUIRED',
        'MILESTONES_NOT_100',
      ]),
    );
  });

  it('submit moves the opportunity to stage 4 and starts the 10 business-day SLA (China calendar)', async () => {
    const s = await setupAt3('400000');
    const prId = await submitPriceRequest(am, s, { targetPrice: '400000' });
    const pr = await okData(am.get(`/price-requests/${prId}`));
    expect(pr.status).toBe('SUBMITTED');
    expect(pr.slaDays).toBe(10);
    expect(pr.slaDueOn).toBe('2026-11-18');
    expect((await okData(am.get(`/opportunities/${s.oppId}`))).stage).toBe(4);
    // VP (I in P5) is read-only (ADM-02)
    expect((await vp.get(`/price-requests/${prId}`)).status).toBe(200);
    expect((await vp.patch(`/price-requests/${prId}`, { summary: 'x' })).status).toBe(403);
    // A1 cannot be edited after submission
    expect(codes(await am.patch(`/price-requests/${prId}`, { summary: 'x' }))).toEqual([
      'PRICE_REQUEST_NOT_DRAFT',
    ]);
  });
});

describe('P6 approval matrix on real sheets', () => {
  it('Equifiber v7.0: 58.0 % / 50.3 %, VP band, business case required, cash flow ≠ T&C', async () => {
    const s = await setupAt3('1881878', 'Equifiber — OSS fase 1');
    const prId = await submitPriceRequest(am, s, { targetPrice: '1881878' });
    // only China Sales loads sheet versions
    expect((await am.post(`/price-requests/${prId}/sheet-versions`, {})).status).toBe(403);
    const sheet = await loadSheet(china, prId, {
      versionLabel: '7.0',
      fileStandardName: 'CL_EQUIFIBER_SHEET_OSS-F1_v7.0_2025-08-05.xlsx',
      fileUrl: 'https://repo.example.com/equifiber/sheet-v7.xlsx',
      lineItems: [
        {
          lineNo: 1,
          block: 'OSS fase 1',
          itemType: 'OWN_SOFTWARE',
          capexOpex: 'CAPEX',
          cost: '166640',
          priceExTax: '476114',
          netIncome: '413311',
          commercialCosts: '62803',
        },
        {
          lineNo: 2,
          block: 'OSS fase 1',
          itemType: 'IMPLEMENTATION',
          capexOpex: 'CAPEX',
          cost: '520132',
          priceExTax: '1405764',
          netIncome: '1220333',
          commercialCosts: '185431',
        },
      ],
      cashflowMilestones: milestonesPct([20, 20, 50, 10]),
      tcMilestones: milestonesPct([30, 50, 20]),
    });
    expect(sheet.netMargin).toBe('0.579607');
    expect(sheet.contractMargin).toBe('0.503153');
    expect(sheet.proposedBand).toBe('VP');
    expect(sheet.milestoneCheck.equal).toBe(false);
    const preview = await okData(am.get(`/sheet-versions/${sheet.id}/approval-preview`));
    expect(preview).toMatchObject({ band: 'VP', requiresBusinessCase: true, blocked: false });
    expect(preview.steps[0]).toMatchObject({ kind: 'MARGIN_VP', assigneeRole: 'VP' });
    const r = await am.post(`/sheet-versions/${sheet.id}/approval-requests`, {});
    expect(r.status).toBe(422);
    expect(codes(r)).toEqual(['BUSINESS_CASE_REQUIRED']);

    // P4: business case (TCO horizon 3–5) approved by the CM, then the VP approves
    const bc = await okData(
      am.post(`/opportunities/${s.oppId}/business-cases`, { pain: 'Fibra sin aseguramiento' }),
    );
    expect(codes(await am.post(`/business-cases/${bc.id}/submit`))).toEqual(
      expect.arrayContaining(['FIELD_REQUIRED', 'TCO_HORIZON_REQUIRED']),
    );
    const bc2 = await okData(
      am.post(`/opportunities/${s.oppId}/business-cases`, {
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
    await okData(am.post(`/business-cases/${bc2.id}/submit`));
    expect(
      (await am.post(`/business-cases/${bc2.id}/decision`, { decision: 'APPROVED' })).status,
    ).toBe(403);
    await okData(cm.post(`/business-cases/${bc2.id}/decision`, { decision: 'APPROVED' }));
    const ar = await okData(am.post(`/sheet-versions/${sheet.id}/approval-requests`, {}));
    expect(ar.band).toBe('VP');
    const inbox = await okData(vp.get('/approvals'));
    const step = inbox.find((x: { approvalRequestId: string }) => x.approvalRequestId === ar.id);
    expect(step.kind).toBe('MARGIN_VP');
    expect(
      (await president.post(`/approval-steps/${step.id}/decision`, { decision: 'APPROVED' }))
        .status,
    ).toBe(403);
    expect(
      codes(await vp.post(`/approval-steps/${step.id}/decision`, { decision: 'REJECTED' })),
    ).toEqual(['COMMENT_REQUIRED']);
    const d = await okData(
      vp.post(`/approval-steps/${step.id}/decision`, { decision: 'APPROVED' }),
    );
    expect(d).toMatchObject({ requestStatus: 'APPROVED', expiresOn: '2027-01-03' });
    const opp = await okData(am.get(`/opportunities/${s.oppId}`));
    expect(opp).toMatchObject({ approvedNetMargin: '0.579607', approvalExpiresOn: '2027-01-03' });

    await approveCompliance(am, legal, cm, s.oppId);
    // 4→5 blocked: cash flow 20/20/50/10 vs T&C 30/50/20 (P7-02)
    const g = await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 5 });
    expect(g.status).toBe(422);
    expect(codes(g)).toEqual(['CASHFLOW_TC_MISMATCH']);
    expect(g.body.errors[0].params).toMatchObject({
      cashflow: '20.00/20.00/50.00/10.00',
      tc: '30.00/50.00/20.00',
    });

    // a corrected sheet version invalidates the approval (P6-05)
    await loadSheet(china, prId, {
      versionLabel: '7.1',
      lineItems: [
        lineAt(1, 'OWN_SOFTWARE', 476114, 0.597),
        lineAt(2, 'IMPLEMENTATION', 1405764, 0.574),
      ],
    });
    const after = await okData(am.get(`/opportunities/${s.oppId}`));
    expect(after.approval.status).toBe('INVALIDATED');
    expect(codes(await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 5 }))).toContain(
      'APPROVAL_MISSING',
    );
  });

  it('48 % line → not quotable; L2 at 63.84 % → Alex Xiao with competitive justification', async () => {
    const s = await setupAt3('900000');
    const prId = await submitPriceRequest(am, s, { targetPrice: '900000' });
    const low = await loadSheet(china, prId, {
      lineItems: [
        lineAt(1, 'OWN_SOFTWARE', 500000, 0.7),
        lineAt(2, 'IMPLEMENTATION', 400000, 0.48),
      ],
    });
    const blocked = await am.post(`/sheet-versions/${low.id}/approval-requests`, {});
    expect(codes(blocked)).toEqual(['NOT_QUOTABLE_BELOW_50']);

    const ok = await loadSheet(china, prId, {
      versionLabel: '2.0',
      lineItems: [
        lineAt(1, 'OWN_SOFTWARE', 500000, 0.7),
        lineAt(2, 'SUPPORT_L3', 250000, 0.8, 'OPEX'),
        lineAt(4, 'SUPPORT_L1L2', 150000, 0.6384, 'OPEX'),
      ],
      tcTerms: { offerValidityDays: 30, paymentTermDays: 90 },
    });
    expect(ok.proposedBand).toBe('PRESIDENT');
    expect(codes(await am.post(`/sheet-versions/${ok.id}/approval-requests`, {}))).toEqual([
      'JUSTIFICATION_REQUIRED',
    ]);
    const ar = await okData(
      am.post(`/sheet-versions/${ok.id}/approval-requests`, {
        competitiveJustification: 'Huawei ofertó 15 % bajo',
      }),
    );
    const full = await okData(am.get(`/approval-requests/${ar.id}`));
    // payment term 90 days → extra non-economic step (P6-03)
    expect(full.steps.map((x: { kind: string }) => x.kind)).toEqual([
      'MARGIN_PRESIDENT',
      'NON_ECONOMIC',
    ]);
    for (const st of full.steps) {
      await okData(president.post(`/approval-steps/${st.id}/decision`, { decision: 'APPROVED' }));
    }
    expect((await okData(am.get(`/approval-requests/${ar.id}`))).status).toBe('APPROVED');
    // P14-02: proposal blocked until the compliance checklist is approved
    expect(codes(await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 5 }))).toEqual([
      'COMPLIANCE_PENDING',
    ]);
    await approveCompliance(am, legal, cm, s.oppId);
    // 4 → 5 → 6 now pass
    await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 5 }));
    await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 6 }));
    // scope change (amount) invalidates the approval
    const o = await okData(am.get(`/opportunities/${s.oppId}`));
    await okData(
      am.patch(`/opportunities/${s.oppId}`, {
        rowVersion: o.rowVersion,
        amount: '950000',
        reason: 'Alcance',
      }),
    );
    expect((await okData(am.get(`/approval-requests/${ar.id}`))).status).toBe('INVALIDATED');
  });
});

describe('P7 → P8: contract, milestones, invoice, payment, collections', () => {
  it('runs the full cycle with gates, evidence, escalation and derived stages', async () => {
    const s = await setupAt3('1000000');
    const prId = await submitPriceRequest(am, s, { targetPrice: '1000000' });
    const sheet = await loadSheet(china, prId, {
      lineItems: [
        lineAt(1, 'OWN_SOFTWARE', 600000, 0.7),
        lineAt(2, 'IMPLEMENTATION', 400000, 0.65),
      ],
    });
    const ar = await okData(am.post(`/sheet-versions/${sheet.id}/approval-requests`, {}));
    expect(ar.band).toBe('COMMITTEE');
    const [step] = (await okData(am.get(`/approval-requests/${ar.id}`))).steps;
    await okData(
      china.post(`/approval-steps/${step.id}/decision`, {
        decision: 'APPROVED',
        comment: 'Acta comité',
      }),
    );
    await approveCompliance(am, legal, cm, s.oppId);
    await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 6 }));

    // 6→7 needs signed contract with standard name + China system ID
    expect(codes(await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 7 }))).toEqual([
      'SIGNED_CONTRACT_MISSING',
      'CHINA_SYSTEM_ID_MISSING',
    ]);
    const contract = await okData(
      am.post('/contracts', {
        accountId: s.accountId,
        opportunityId: s.oppId,
        type: 'SOW',
        number: 'SOW-2026-01',
        title: 'SOW Digital OSS',
        billingEntityId: entityId,
        billingEngine: 'A',
        amount: '1000000',
        currency: 'USD',
      }),
    );
    expect(codes(await am.patch(`/contracts/${contract.id}`, { status: 'ACTIVE' }))).toEqual([
      'REPOSITORY_LINK_REQUIRED',
    ]);
    const badName = await am.post(`/contracts/${contract.id}/sign`, {
      signedOn: '2026-11-03',
      repositoryUrl: 'https://repo.example.com/x',
      standardName: 'contrato firmado.pdf',
      chinaSystemId: 'CN-1',
    });
    expect(badName.status).toBe(400);
    expect(badName.body.errors[0].code).toBe('NAMING_INVALID');
    await okData(
      am.post(`/contracts/${contract.id}/sign`, {
        signedOn: '2026-11-03',
        repositoryUrl: 'https://repo.example.com/cliente/sow',
        standardName: 'CL_CLIENTE_SOW_SOW-2026-01_v1_2026-11-03.pdf',
        chinaSystemId: 'CN-2026-0042',
      }),
    );
    const won = await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 7 }));
    expect(won.customerTypeFrozen).toBe('NEW');

    // 7→8 handoff with local + China delivery and ZMP id (P9-02)
    expect(codes(await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 8 }))).toEqual(
      expect.arrayContaining(['HANDOFF_MISSING']),
    );
    await okData(
      am.post(`/opportunities/${s.oppId}/handoff`, {
        meetingAt: '2026-11-04',
        attendeeUserIds: [localDeliveryId, chinaDeliveryId],
        zmpProjectId: 'ZMP-7788',
        ...HANDOFF_CHECKLIST_OK,
      }),
    );
    await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 8 }));

    // P7-06 milestones from approved T&C (30/50/20)
    const ms = await okData(am.post(`/contracts/${contract.id}/milestones/from-tc`));
    expect(ms.map((m: { amount: string }) => m.amount)).toEqual([
      '300000.00',
      '500000.00',
      '200000.00',
    ]);
    const m1 = ms[0].id;
    const ld = client(app, await as(app, ['LOCAL_DELIVERY']));
    await okData(ld.post(`/milestones/${m1}/ready`));
    expect(codes(await am.post(`/milestones/${m1}/accept`))).toEqual(['EVIDENCE_MISSING']);
    const ev = (type: string, sig?: string) => ({
      evidenceType: type,
      url: `https://repo.example.com/cliente/${type.toLowerCase()}`,
      standardName: `CL_CLIENTE_${type === 'RECEPTION' ? 'REC' : type === 'SIGNED_AC' ? 'AC' : type === 'MSA' ? 'MSA' : 'OTHER'}_H1_v1_2026-11-04.pdf`,
      receivedOn: '2026-11-04',
      signatureType: sig,
    });
    expect(
      codes(await am.post(`/milestones/${m1}/evidence`, ev('SIGNED_AC', 'SIMPLE_ESIGN'))),
    ).toEqual(['SIMPLE_ESIGN_NOT_ACCEPTED']);
    for (const t of ['ACCEPTANCE_EMAIL', 'MSA', 'SIGNED_AC', 'RECEPTION']) {
      await okData(
        am.post(
          `/milestones/${m1}/evidence`,
          ev(t, t === 'SIGNED_AC' ? 'HANDWRITTEN_SCAN' : undefined),
        ),
      );
    }
    const acc = await okData(am.post(`/milestones/${m1}/accept`));
    expect(acc).toMatchObject({ status: 'ACCEPTED', recognizedOn: '2026-11-04' });
    expect((await okData(am.get(`/opportunities/${s.oppId}`))).stage).toBe(8); // other milestones pending

    await okData(am.post(`/milestones/${m1}/send-to-finance`));
    const line = (await okData(am.get(`/milestones?opportunityId=${s.oppId}`)))[0].billingLines[0];
    const invBody = {
      number: uniq('F-'),
      issuedOn: '2026-10-16',
      amount: '300000',
      currency: 'USD',
    };
    expect((await am.post(`/milestone-billing-lines/${line.id}/invoices`, invBody)).status).toBe(
      403,
    );
    const inv = await okData(finance.post(`/milestone-billing-lines/${line.id}/invoices`, invBody));
    expect(inv.dueOn).toBe('2026-11-30'); // 45 days default term
    const actions = await okData(am.get('/collection-actions'));
    const mine = actions.filter((a: { invoiceId: string }) => a.invoiceId === inv.id);
    expect(
      mine.map((a: { step: string; scheduledOn: string }) => `${a.step}@${a.scheduledOn}`),
    ).toEqual([
      'D_MINUS_10@2026-11-20',
      'D_PLUS_1@2026-12-01',
      'D_PLUS_7@2026-12-07',
      'D_PLUS_15@2026-12-15',
      'D_PLUS_30@2026-12-30',
    ]);
    // on 2026-12-15 the +15 step belongs to the CM and notifies the LatAm president (P8-06)
    const finance15 = client(app, await as(app, ['CHINA_FINANCE']), '2026-12-15');
    const invs = await okData(finance15.get('/invoices'));
    const esc = invs.find((i: { id: string }) => i.id === inv.id).escalation;
    expect(esc).toMatchObject({ currentStep: 'D_PLUS_15', responsibleRoles: ['COUNTRY_MANAGER'] });
    expect(esc.notifyRoles).toContain('LATAM_PRESIDENT');
    const plus15 = mine.find((a: { step: string }) => a.step === 'D_PLUS_15');
    expect(plus15).toMatchObject({ responsibleRole: 'COUNTRY_MANAGER' });
    expect(
      (await am.post(`/collection-actions/${plus15.id}/complete`, { outcome: 'x' })).status,
    ).toBe(403);
    expect(
      codes(await cm.post(`/collection-actions/${plus15.id}/complete`, { outcome: 'Llamada' })),
    ).toEqual(['COLLECTION_NOT_DUE']);
    const cm15 = client(app, await as(app, ['COUNTRY_MANAGER']), '2026-12-15');
    await okData(
      cm15.post(`/collection-actions/${plus15.id}/complete`, {
        outcome: 'Carta al gerente de finanzas',
      }),
    );

    // partial 60 % then full payment (P8-07)
    const p1 = await okData(
      finance.post(`/invoices/${inv.id}/payments`, {
        paidOn: '2026-12-20',
        amount: '180000',
        currency: 'USD',
      }),
    );
    expect(p1.invoiceBalance).toBe('120000.00');
    let msList = await okData(am.get(`/milestones?opportunityId=${s.oppId}`));
    expect(msList[0].status).toBe('PARTIALLY_PAID');
    expect(
      codes(
        await finance.post(`/invoices/${inv.id}/payments`, {
          paidOn: '2026-12-21',
          amount: '999999',
          currency: 'USD',
        }),
      ),
    ).toEqual(['PAYMENT_EXCEEDS_BALANCE']);
    // cancel the remaining milestones so the derived stage depends only on milestone 1
    await app.ctx.pool.query(
      `UPDATE milestones SET status = 'CANCELLED' WHERE opportunity_id = $1 AND seq > 1`,
      [s.oppId],
    );
    await okData(
      finance.post(`/invoices/${inv.id}/payments`, {
        paidOn: '2026-12-22',
        amount: '120000',
        currency: 'USD',
      }),
    );
    msList = await okData(am.get(`/milestones?opportunityId=${s.oppId}`));
    expect(msList[0].status).toBe('PAID');
    const after = (await okData(am.get('/collection-actions'))).filter(
      (a: { invoiceId: string }) => a.invoiceId === inv.id,
    );
    expect(after.find((a: { step: string }) => a.step === 'D_PLUS_30').status).toBe('CANCELLED');
    expect(after.find((a: { step: string }) => a.step === 'D_PLUS_15').status).toBe('DONE');

    // derived stage = minimum milestone state → 11 (Cobrada), recorded as derived (CORE-06)
    const stageHist = await app.ctx.pool.query(
      `SELECT to_stage, derived FROM stage_history WHERE opportunity_id = $1 ORDER BY id`,
      [s.oppId],
    );
    expect(stageHist.rows.at(-1)).toMatchObject({ to_stage: 11, derived: true });
  });
});
