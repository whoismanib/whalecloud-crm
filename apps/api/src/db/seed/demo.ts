import type { FastifyInstance } from 'fastify';
import type { UserRole } from '@wcrm/shared';
import { eq } from 'drizzle-orm';
import type { Config } from '../../config';
import type { Db } from '../client';
import { accounts } from '../schema/index';
import { upsertUser } from './base';
import { runJob } from '../../jobs/index';
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
} from './flows';

/** Demo users from the RACI (source "Matriz de responsables"); password SEED_DEMO_PASSWORD. */
export const DEMO_USERS: {
  key: string;
  email: string;
  fullName: string;
  roles: UserRole[];
  locale?: string;
  timezone?: string;
  calendarId?: string;
  countryCodes?: string[];
}[] = [
  {
    key: 'cm',
    email: 'jesus.depablo@example.com',
    fullName: 'Jesús de Pablo',
    roles: ['COUNTRY_MANAGER'],
  },
  {
    key: 'am',
    email: 'manuel.ibieta@example.com',
    fullName: 'Manuel Ibieta',
    roles: ['ACCOUNT_MANAGER'],
  },
  {
    key: 'lin',
    email: 'lin.han@example.com',
    fullName: 'Lin Han',
    roles: ['CHINA_SALES'],
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    calendarId: 'CN',
    countryCodes: ['*'],
  },
  {
    key: 'kong',
    email: 'alex.kong@example.com',
    fullName: 'Alex Kong',
    roles: ['CHINA_SALES'],
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    calendarId: 'CN',
    countryCodes: ['*'],
  },
  {
    key: 'cnDelivery',
    email: 'delivery.china@example.com',
    fullName: 'I+D y Delivery China',
    roles: ['CHINA_DELIVERY'],
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    calendarId: 'CN',
    countryCodes: ['*'],
  },
  {
    key: 'clDelivery',
    email: 'delivery.chile@example.com',
    fullName: 'Delivery Local Chile',
    roles: ['LOCAL_DELIVERY'],
  },
  {
    key: 'finance',
    email: 'finanzas.china@example.com',
    fullName: 'Finanzas China',
    roles: ['CHINA_FINANCE'],
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    calendarId: 'CN',
    countryCodes: ['*'],
  },
  {
    key: 'legal',
    email: 'legal.china@example.com',
    fullName: 'Legal China',
    roles: ['CHINA_LEGAL'],
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    calendarId: 'CN',
    countryCodes: ['*'],
  },
  {
    key: 'vp',
    email: 'jacky@example.com',
    fullName: 'Jacky',
    roles: ['VP'],
    timezone: 'Asia/Shanghai',
    calendarId: 'CN',
    countryCodes: ['*'],
  },
  {
    key: 'president',
    email: 'alex.xiao@example.com',
    fullName: 'Alex Xiao',
    roles: ['LATAM_PRESIDENT'],
    countryCodes: ['*'],
  },
];

function injectClient(
  app: FastifyInstance,
  cookie: string,
  csrf: string,
  today: string,
): ApiClient {
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, body?: object) => {
    const r = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { cookie, 'x-csrf-token': csrf, 'x-test-today': today },
      payload: method === 'GET' ? undefined : (body ?? {}),
    });
    return { status: r.statusCode, body: r.json() };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b),
    put: (u, b) => call('PUT', u, b),
    patch: (u, b) => call('PATCH', u, b),
  };
}

async function loginInject(app: FastifyInstance, email: string, password: string, today: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  if (r.statusCode !== 200) throw new Error(`demo login ${email}: ${r.body}`);
  const cookie = r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return injectClient(app, cookie, r.json().data.csrfToken, today);
}

/**
 * Demo data from the source document (WOM, BancoEstado, Entel, GTD, Equifiber, Coopeuch), created
 * through the API so every gate, approval rule and audit entry applies; a few timestamps are then
 * back-dated so KPIs (price time, pending acceptances, aging, staleness) have realistic values.
 */
export async function seedDemo(app: FastifyInstance, db: Db, config: Config, today: string) {
  const [already] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.name, 'WOM'));
  if (already) {
    console.log('demo data already present — skipped');
    return;
  }
  const ids: Record<string, string> = {};
  const c: Record<string, ApiClient> = {};
  for (const u of DEMO_USERS) {
    ids[u.key] = await upsertUser(db, config, { ...u, password: config.SEED_DEMO_PASSWORD });
  }
  for (const u of DEMO_USERS)
    c[u.key] = await loginInject(app, u.email, config.SEED_DEMO_PASSWORD, today);
  const am = c.am!;
  const cat = await okData(am.get('/catalogs'));
  const spa = cat.billingEntities.find((b: { code: string }) => b.code === 'WC_CL_SPA').id;

  const acct = async (
    name: string,
    vertical: string,
    customerType: 'NEW' | 'EXISTING',
    extra: object = {},
  ) =>
    (
      await okData(
        am.post('/accounts', {
          name,
          countryCode: 'CL',
          vertical,
          customerType,
          defaultBillingEntityId: spa,
          currency: 'USD',
          ...extra,
        }),
      )
    ).id as string;
  const wom = await acct('WOM', 'TELECOM_BSS', 'EXISTING', {
    isKeyAccount: true,
    legalName: 'WOM S.A.',
  });
  const be = await acct('BancoEstado', 'FINTECH', 'EXISTING', {
    isKeyAccount: true,
    legalName: 'Banco del Estado de Chile',
    currency: 'CLP',
  });
  const entel = await acct('Entel', 'TELECOM_OSS', 'NEW');
  const gtd = await acct('GTD', 'CLOUD_DATA', 'NEW');
  const equifiber = await acct('Equifiber', 'TELECOM_OSS', 'NEW');
  const coopeuch = await acct('Coopeuch', 'FINTECH', 'NEW');

  const won = async (
    s: OppSetup,
    contract: {
      type: string;
      number: string;
      title: string;
      amount: string;
      signedOn: string;
      name: string;
      engine: string;
    },
  ) => {
    const k = await okData(
      am.post('/contracts', {
        accountId: s.accountId,
        opportunityId: s.oppId,
        type: contract.type,
        number: contract.number,
        title: contract.title,
        billingEntityId: spa,
        billingEngine: contract.engine,
        amount: contract.amount,
        currency: 'USD',
        startDate: contract.signedOn,
        renewable: contract.engine === 'C',
      }),
    );
    await okData(
      am.post(`/contracts/${k.id}/sign`, {
        signedOn: contract.signedOn,
        repositoryUrl: `https://repositorio.whalecloud-latam.example/${contract.name}`,
        standardName: contract.name,
        chinaSystemId: `CN-${contract.number}`,
      }),
    );
    await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 7 }));
    await okData(
      am.post(`/opportunities/${s.oppId}/handoff`, {
        meetingAt: contract.signedOn,
        attendeeUserIds: [ids.clDelivery, ids.cnDelivery, ids.am],
        zmpProjectId: `ZMP-${contract.number}`,
        acceptanceCriteria: 'UAT firmada por el cliente y acta de recepción',
        plannedStart: contract.signedOn,
        ...HANDOFF_CHECKLIST_OK,
      }),
    );
    await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 8 }));
    return k.id as string;
  };

  const evidence = async (msId: string, types: string[], client: string, date: string) => {
    for (const t of types) {
      const kind =
        t === 'RECEPTION'
          ? 'REC'
          : t === 'SIGNED_AC'
            ? 'AC'
            : t === 'PO'
              ? 'OC'
              : t === 'MSA'
                ? 'MSA'
                : 'OTHER';
      await okData(
        am.post(`/milestones/${msId}/evidence`, {
          evidenceType: t,
          url: `https://repositorio.whalecloud-latam.example/${client}/${t.toLowerCase()}-${msId.slice(0, 8)}`,
          standardName: `CL_${client}_${kind}_${msId.slice(0, 8)}_v1_${date}.pdf`,
          receivedOn: date,
          signatureType: t === 'SIGNED_AC' || t === 'RECEPTION' ? 'HANDWRITTEN_SCAN' : undefined,
        }),
      );
    }
  };
  const invoiceAndPay = async (
    msId: string,
    number: string,
    issuedOn: string,
    amount: string,
    paidOn?: string,
  ) => {
    await okData(am.post(`/milestones/${msId}/send-to-finance`));
    const all = await okData(c.finance!.get(`/milestones`));
    const line = all.find((m: { id: string }) => m.id === msId).billingLines[0];
    const inv = await okData(
      c.finance!.post(`/milestone-billing-lines/${line.id}/invoices`, {
        number,
        issuedOn,
        amount,
        currency: 'USD',
      }),
    );
    if (paidOn) {
      await okData(
        c.finance!.post(`/invoices/${inv.id}/payments`, {
          paidOn,
          amount,
          currency: 'USD',
          reference: `TRF-${number}`,
        }),
      );
    }
    return inv.id as string;
  };

  // 1) BancoEstado — RutPay fase 3: won, in delivery; milestones paid / overdue / pending AC
  const beOpp = await createOpportunity(am, {
    accountId: be,
    name: 'BancoEstado — RutPay fase 3',
    vertical: 'FINTECH',
    engine: 'A',
    amount: '4500000',
    close: '2026-03-31',
    firstContact: '2025-11-03',
    contact: {
      firstName: 'Carolina',
      lastName: 'Fuentes',
      jobTitle: 'Gerente de Canales Digitales',
      roles: ['ECONOMIC_BUYER', 'SPONSOR'],
    },
    forecastCategory: 'COMMIT',
  });
  await qualifyTo(am, beOpp, 3, { meddpicc: 'FULL', decisionDate: '2026-03-01' });
  const bePr = await submitPriceRequest(am, beOpp, { targetPrice: '4500000' });
  const beSheet = await loadSheet(c.lin!, bePr, {
    versionLabel: '4.0',
    fileStandardName: 'CL_BANCOESTADO_SHEET_RUTPAY-F3_v4.0_2026-02-13.xlsx',
    fileUrl: 'https://repositorio.whalecloud-latam.example/bancoestado/sheet-v4.xlsx',
    lineItems: [
      lineAt(1, 'OWN_SOFTWARE', 2000000, 0.7),
      lineAt(2, 'IMPLEMENTATION', 1800000, 0.66),
      lineAt(3, 'SUPPORT_L3', 700000, 0.81, 'OPEX'),
    ],
  });
  const bc = await okData(
    am.post(`/opportunities/${beOpp.oppId}/business-cases`, {
      pain: 'Crecimiento de transacciones RutPay sin escalabilidad',
      baselineMetric: '1,2 MM transacciones/día',
      benefit: '3x capacidad y menor costo por transacción',
      tcoHorizonYears: 5,
      tco: '9800000',
      tcoCurrency: 'USD',
      risks: 'Dependencia de integración con core bancario',
      strategicValue: 'Cliente principal; referencia Alipay+ LatAm',
    }),
  );
  await okData(am.post(`/business-cases/${bc.id}/submit`));
  await okData(
    c.cm!.post(`/business-cases/${bc.id}/decision`, {
      decision: 'APPROVED',
      comment: 'Caso sólido',
    }),
  );
  const beAr = await okData(am.post(`/sheet-versions/${beSheet.id}/approval-requests`, {}));
  for (const st of (await okData(am.get(`/approval-requests/${beAr.id}`))).steps) {
    await okData(
      c.lin!.post(`/approval-steps/${st.id}/decision`, {
        decision: 'APPROVED',
        comment: 'Acta comité de precios 2026-02-13',
      }),
    );
  }
  await approveCompliance(am, c.legal!, c.cm!, beOpp.oppId);
  await okData(am.post(`/opportunities/${beOpp.oppId}/transitions`, { toStage: 6 }));
  const beContract = await won(beOpp, {
    type: 'SOW',
    number: 'RUTPAY-F3',
    title: 'SOW RutPay fase 3',
    amount: '4500000',
    signedOn: '2026-03-10',
    name: 'CL_BANCOESTADO_SOW_RUTPAY-F3_v1_2026-03-10.pdf',
    engine: 'A',
  });
  const beMs = await okData(am.post(`/contracts/${beContract}/milestones/from-tc`));
  for (const m of beMs.slice(0, 3)) await okData(c.clDelivery!.post(`/milestones/${m.id}/ready`));
  await evidence(
    beMs[0].id,
    ['ACCEPTANCE_EMAIL', 'MSA', 'SIGNED_AC', 'RECEPTION'],
    'BANCOESTADO',
    '2026-03-25',
  );
  await okData(am.post(`/milestones/${beMs[0].id}/accept`));
  await invoiceAndPay(beMs[0].id, 'F-2026-0311', '2026-03-31', '1350000.00', '2026-05-12');
  await evidence(
    beMs[1].id,
    ['ACCEPTANCE_EMAIL', 'MSA', 'SIGNED_AC', 'RECEPTION'],
    'BANCOESTADO',
    '2026-08-28',
  );
  await okData(am.post(`/milestones/${beMs[1].id}/accept`));
  await invoiceAndPay(beMs[1].id, 'F-2026-0904', '2026-09-01', '2250000.00');

  // 2) WOM — CR equipo residente 2026 (engine B, 90-day payment term → non-economic approval)
  const womCr = await createOpportunity(am, {
    accountId: wom,
    name: 'WOM — CR equipo residente 2026',
    vertical: 'TELECOM_BSS',
    engine: 'B',
    amount: '420000',
    close: '2026-05-30',
    firstContact: '2026-04-01',
    contact: {
      firstName: 'Rodrigo',
      lastName: 'Saavedra',
      jobTitle: 'Gerente de Sistemas',
      roles: ['ECONOMIC_BUYER', 'CONTRACT_OWNER'],
    },
    forecastCategory: 'COMMIT',
  });
  await qualifyTo(am, womCr, 3, { decisionDate: '2026-05-20' });
  const womCrPr = await submitPriceRequest(am, womCr, { targetPrice: '420000', expected: [100] });
  const crSheet = await loadSheet(c.kong!, womCrPr, {
    versionLabel: '1.0',
    lineItems: [lineAt(1, 'IMPLEMENTATION', 420000, 0.66)],
    cashflowMilestones: milestonesPct([100], ['PO_RECEPTION']),
    tcMilestones: milestonesPct([100], ['PO_RECEPTION']),
    tcTerms: { offerValidityDays: 30, paymentTermDays: 90 },
  });
  const crAr = await okData(am.post(`/sheet-versions/${crSheet.id}/approval-requests`, {}));
  for (const st of (await okData(am.get(`/approval-requests/${crAr.id}`))).steps) {
    const who = st.assigneeRole === 'CHINA_SALES' ? c.kong! : c.president!;
    await okData(
      who.post(`/approval-steps/${st.id}/decision`, { decision: 'APPROVED', comment: 'OK' }),
    );
  }
  await approveCompliance(am, c.legal!, c.cm!, womCr.oppId);
  await okData(am.post(`/opportunities/${womCr.oppId}/transitions`, { toStage: 6 }));
  const crContract: string = await won(womCr, {
    type: 'OC',
    number: '4500123',
    title: 'OC equipo residente 2026',
    amount: '420000',
    signedOn: '2026-06-01',
    name: 'CL_WOM_OC_4500123_v1_2026-06-01.pdf',
    engine: 'B',
  });
  const crMs = await okData(am.post(`/contracts/${crContract}/milestones/from-tc`));
  await okData(c.clDelivery!.post(`/milestones/${crMs[0].id}/ready`));
  await evidence(crMs[0].id, ['PO', 'RECEPTION'], 'WOM', '2026-07-28');
  await okData(am.post(`/milestones/${crMs[0].id}/accept`));
  await invoiceAndPay(crMs[0].id, 'F-2026-0801', '2026-08-01', '420000.00');

  // 3) WOM — ZSmart BSS V9: approved by Alex Xiao (L2 at 63.84 %), negotiation (legacy PVB)
  const womV9 = await createOpportunity(am, {
    accountId: wom,
    name: 'WOM — Upgrade ZSmart BSS V9',
    vertical: 'TELECOM_BSS',
    engine: 'A',
    amount: '1850000',
    close: '2026-12-18',
    firstContact: '2026-07-14',
    contact: {
      firstName: 'Paula',
      lastName: 'Riquelme',
      jobTitle: 'VP Tecnología',
      roles: ['ECONOMIC_BUYER'],
    },
    forecastCategory: 'PROBABLE',
    risk: 'MEDIUM',
  });
  await qualifyTo(am, womV9, 3, { meddpicc: 'FULL', decisionDate: '2026-12-05' });
  const v9Pr = await submitPriceRequest(am, womV9, { targetPrice: '1850000' });
  const v9Sheet = await loadSheet(c.lin!, v9Pr, {
    versionLabel: '3.0',
    lineItems: [
      lineAt(1, 'OWN_SOFTWARE', 700000, 0.68),
      lineAt(2, 'IMPLEMENTATION', 650000, 0.64),
      lineAt(3, 'SUPPORT_L3', 350000, 0.8, 'OPEX'),
      lineAt(4, 'SUPPORT_L1L2', 150000, 0.6384, 'OPEX'),
    ],
  });
  const v9Ar = await okData(
    am.post(`/sheet-versions/${v9Sheet.id}/approval-requests`, {
      competitiveJustification: 'Amdocs ofertó L2 15 % bajo; mantener la base instalada',
    }),
  );
  for (const st of (await okData(am.get(`/approval-requests/${v9Ar.id}`))).steps) {
    await okData(
      c.president!.post(`/approval-steps/${st.id}/decision`, {
        decision: 'APPROVED',
        comment: 'Aprobado por competencia',
      }),
    );
  }
  await approveCompliance(am, c.legal!, c.cm!, womV9.oppId);
  await okData(am.post(`/opportunities/${womV9.oppId}/transitions`, { toStage: 6 }));

  // 4) Equifiber — OSS fase 1 (source example): v7.0 → 58.0 % / 50.3 %, VP band, cash flow ≠ T&C
  const eq1 = await createOpportunity(am, {
    accountId: equifiber,
    name: 'Equifiber — OSS fase 1',
    vertical: 'TELECOM_OSS',
    engine: 'A',
    amount: '1881878',
    close: '2026-12-22',
    firstContact: '2026-09-01',
    contact: {
      firstName: 'Ignacio',
      lastName: 'Vergara',
      jobTitle: 'Gerente General',
      roles: ['ECONOMIC_BUYER'],
    },
    risk: 'HIGH',
  });
  await qualifyTo(am, eq1, 3, { decisionDate: '2026-12-15' });
  const eqPr = await submitPriceRequest(am, eq1, {
    targetPrice: '1800000',
    expected: [30, 50, 20],
  });
  await loadSheet(c.lin!, eqPr, {
    versionLabel: '7.0',
    fileStandardName: 'CL_EQUIFIBER_SHEET_OSS-F1_v7.0_2026-10-21.xlsx',
    fileUrl: 'https://repositorio.whalecloud-latam.example/equifiber/sheet-v7.xlsx',
    lineItems: [
      {
        lineNo: 1,
        block: 'OSS fase 1',
        itemType: 'OWN_SOFTWARE',
        capexOpex: 'CAPEX',
        description: 'Software OSS',
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
        description: 'Implementación',
        cost: '520132',
        priceExTax: '1405764',
        netIncome: '1220333',
        commercialCosts: '185431',
      },
    ],
    cashflowMilestones: milestonesPct([20, 20, 50, 10]),
    tcMilestones: milestonesPct([30, 50, 20]),
  });

  // 5–9) Early pipeline
  const entelOpp = await createOpportunity(am, {
    accountId: entel,
    name: 'Entel — RFI Digital OSS / iNOC',
    vertical: 'TELECOM_OSS',
    engine: 'A',
    amount: '900000',
    close: '2027-03-31',
    firstContact: '2026-09-15',
    contact: {
      firstName: 'Marcela',
      lastName: 'Ortiz',
      jobTitle: 'Gerente de Operaciones de Red',
      roles: ['CHAMPION'],
    },
    origin: 'PUBLIC_RFI',
  });
  await qualifyTo(am, entelOpp, 2);
  const coop = await createOpportunity(am, {
    accountId: coopeuch,
    name: 'Coopeuch — Billetera digital Alipay+',
    vertical: 'FINTECH',
    engine: 'A',
    amount: '1200000',
    close: '2027-02-26',
    firstContact: '2026-08-20',
    contact: {
      firstName: 'Tomás',
      lastName: 'Lagos',
      jobTitle: 'Subgerente Digital',
      roles: ['CHAMPION', 'TECHNICAL_EVALUATOR'],
    },
    origin: 'EVENT',
  });
  await qualifyTo(am, coop, 3, { decisionDate: null });
  const gtdLpc = await createOpportunity(am, {
    accountId: gtd,
    name: 'GTD — Local Public Cloud',
    vertical: 'CLOUD_DATA',
    engine: 'C',
    amount: '650000',
    close: '2027-01-29',
    firstContact: '2026-10-05',
    contact: {
      firstName: 'Felipe',
      lastName: 'Araya',
      jobTitle: 'Gerente de Data Center',
      roles: ['SPONSOR'],
    },
  });
  await qualifyTo(am, gtdLpc, 1);
  await createOpportunity(am, {
    accountId: gtd,
    name: 'GTD — Energy Optimizer para data centers',
    vertical: 'ENERGY',
    engine: 'A',
    amount: '300000',
    close: '2027-04-30',
    firstContact: '2026-10-27',
    contact: {
      firstName: 'Daniela',
      lastName: 'Muñoz',
      jobTitle: 'Jefa de Eficiencia Energética',
      roles: [],
    },
    origin: 'OUTBOUND',
  });
  const beL3 = await createOpportunity(am, {
    accountId: be,
    name: 'BancoEstado — Soporte L3 2027',
    vertical: 'FINTECH',
    engine: 'C',
    amount: '1100000',
    close: '2026-12-30',
    firstContact: '2026-10-01',
    contact: {
      firstName: 'Jorge',
      lastName: 'Henríquez',
      jobTitle: 'Gerente de Operaciones TI',
      roles: ['ECONOMIC_BUYER'],
    },
    forecastCategory: 'PROBABLE',
  });
  await qualifyTo(am, beL3, 3, { meddpicc: 'HALF', decisionDate: '2026-12-10' });
  const eq2 = await createOpportunity(am, {
    accountId: equifiber,
    name: 'Equifiber — OSS fase 2',
    vertical: 'TELECOM_OSS',
    engine: 'A',
    amount: '950000',
    close: '2026-09-30',
    firstContact: '2026-06-02',
    contact: { firstName: 'Ana', lastName: 'Bravo', jobTitle: 'Jefa de Proyectos', roles: [] },
  });
  await okData(
    am.post(`/opportunities/${eq2.oppId}/close`, {
      status: 'LOST',
      reason: 'Precio: margen bajo 50 % para igualar oferta',
      winningCompetitor: 'Huawei',
      winningPrice: '780000',
      winningPriceCurrency: 'USD',
    }),
  );

  // Activities (health) and eDo-like tickets
  const act = (
    accountId: string,
    opportunityId: string,
    type: string,
    occurredAt: string,
    subject: string,
  ) => okData(am.post('/activities', { accountId, opportunityId, type, occurredAt, subject }));
  await act(
    wom,
    womV9.oppId,
    'MEETING',
    '2026-11-03',
    'Negociación final de L2 con Paula Riquelme',
  );
  await act(be, beOpp.oppId, 'MEETING', '2026-10-29', 'Comité de proyecto RutPay — UAT hito 3');
  await act(equifiber, eq1.oppId, 'CALL', '2026-10-22', 'Revisión de alcance OSS fase 1');
  await act(gtd, gtdLpc.oppId, 'DEMO', '2026-10-30', 'Demo LPC en data center Santiago');
  await act(coopeuch, coop.oppId, 'EMAIL', '2026-10-08', 'Envío de propuesta de valor Alipay+');
  await act(entel, entelOpp.oppId, 'MEETING', '2026-09-30', 'Aclaraciones RFI');

  const tickets: [string, string, string, string, string, string, string | null][] = [
    // account, number, title, priority, status, ballIn, slaDueOn
    [
      wom,
      'EDO-24811',
      'Rating prepago: diferencias en tasación de roaming',
      'P1',
      'IN_PROGRESS',
      'WHALE',
      '2026-11-05',
    ],
    [
      wom,
      'EDO-24790',
      'Portabilidad: reintentos fallidos en batch nocturno',
      'P2',
      'PENDING_CLIENT',
      'CLIENT',
      '2026-11-10',
    ],
    [
      wom,
      'EDO-24702',
      'CRM: lentitud en ficha de cliente empresas',
      'P2',
      'OPEN',
      'WHALE',
      '2026-10-30',
    ],
    [
      wom,
      'EDO-24655',
      'Facturación: ciclo 15 con cargos duplicados',
      'P1',
      'RESOLVED',
      'CLIENT',
      '2026-10-20',
    ],
    [
      wom,
      'EDO-24601',
      'Reportes: extracción mensual de uso de datos',
      'P3',
      'PENDING_CLIENT',
      'CLIENT',
      '2026-11-20',
    ],
    [wom, 'EDO-24533', 'OCS: alarma de capacidad en nodo 3', 'P2', 'CLOSED', 'WHALE', '2026-10-10'],
    [
      be,
      'EDO-31002',
      'RutPay: timeouts en conciliación con Alipay+',
      'P1',
      'IN_PROGRESS',
      'WHALE',
      '2026-11-04',
    ],
    [
      be,
      'EDO-30987',
      'App: error de enrolamiento en Android 15',
      'P3',
      'OPEN',
      'CLIENT',
      '2026-11-18',
    ],
  ];
  const opened = [
    '2026-10-28',
    '2026-10-21',
    '2026-10-14',
    '2026-10-02',
    '2026-09-29',
    '2026-09-20',
    '2026-11-02',
    '2026-10-25',
  ];
  for (const [
    i,
    [accountId, number, title, priority, status, ballIn, slaDueOn],
  ] of tickets.entries()) {
    await okData(
      c.cm!.post('/tickets', {
        accountId,
        number,
        title,
        priority,
        status,
        ballIn,
        slaDueOn,
        openedOn: opened[i],
        orgHolder:
          ballIn === 'WHALE'
            ? 'WhaleCloud L2 Santiago'
            : accountId === wom
              ? 'WOM TI'
              : 'BancoEstado TI',
        ownerName: ballIn === 'WHALE' ? 'Soporte L2' : 'Mesa de ayuda cliente',
      }),
    );
  }

  // Back-date timestamps (realistic KPIs: price time, pending acceptances, staleness)
  const q = (text: string, values: unknown[] = []) => app.ctx.pool.query(text, values);
  await q(
    `UPDATE price_requests SET submitted_at = '2026-02-02T15:00Z', sheet_approved_at = '2026-02-13T09:00Z' WHERE id = $1`,
    [bePr],
  );
  await q(
    `UPDATE price_requests SET submitted_at = '2026-05-04T15:00Z', sheet_approved_at = '2026-05-12T09:00Z' WHERE id = $1`,
    [womCrPr],
  );
  await q(
    `UPDATE price_requests SET submitted_at = '2026-10-06T15:00Z', sheet_approved_at = '2026-10-21T09:00Z' WHERE id = $1`,
    [v9Pr],
  );
  await q(
    `UPDATE price_requests SET submitted_at = '2026-10-15T15:00Z', sla_due_on = '2026-10-29' WHERE id = $1`,
    [eqPr],
  );
  await q(`UPDATE opportunities SET won_at = '2026-03-10T15:00Z' WHERE id = $1`, [beOpp.oppId]);
  await q(`UPDATE opportunities SET won_at = '2026-06-01T15:00Z' WHERE id = $1`, [womCr.oppId]);
  await q(
    `UPDATE milestones SET ready_at = '2026-10-05T15:00Z', ac_due_on = '2026-10-19' WHERE id = $1`,
    [beMs[2].id],
  );
  await q(`UPDATE opportunities SET updated_at = '2026-09-30T15:00Z' WHERE id = $1`, [
    entelOpp.oppId,
  ]);
  await q(`UPDATE opportunities SET updated_at = '2026-10-08T15:00Z' WHERE id = $1`, [coop.oppId]);
  await q(`UPDATE opportunities SET updated_at = '2026-10-22T15:00Z' WHERE id = $1`, [eq1.oppId]);
  await q(
    `UPDATE tickets SET last_update_at = now() - interval '6 days' WHERE number IN ('EDO-24702','EDO-24790')`,
  );

  // ---------- Phase 2 demo data (P10–P16) ----------
  await phase2Demo(app, c, ids, { wom, be, gtd, spa, crContract, womV9: womV9.oppId, today });
  console.log('demo data created');
}

async function phase2Demo(
  app: FastifyInstance,
  c: Record<string, ApiClient>,
  ids: Record<string, string>,
  d: { wom: string; be: string; gtd: string; spa: string; crContract: string; womV9: string; today: string },
) {
  const am = c.am!;
  const cm = c.cm!;
  // P10: WOM L2/L3 support contract (engine C, renewable) → renewal calendar
  const sup = await okData(
    am.post('/contracts', {
      accountId: d.wom,
      type: 'SOW',
      number: 'SOP-L3-2026',
      title: 'Soporte L2/L3 ZSmart 2026',
      billingEntityId: d.spa,
      billingEngine: 'C',
      amount: '780000',
      currency: 'USD',
      startDate: '2026-02-01',
      endDate: '2027-01-31',
      renewable: true,
    }),
  );
  await okData(
    am.post(`/contracts/${sup.id}/sign`, {
      signedOn: '2026-01-28',
      repositoryUrl: 'https://repositorio.whalecloud-latam.example/WOM/sop-l3-2026',
      standardName: 'CL_WOM_SOW_SOP-L3-2026_v1_2026-01-28.pdf',
      chinaSystemId: 'CN-SOP-L3-2026',
    }),
  );
  const plan = await okData(
    am.post(`/accounts/${d.wom}/plans`, {
      year: 2026,
      objectives: 'Upgrade V9, renovar soporte L3 y crecer en CRs de portabilidad',
      growthOpportunities: 'ZSmart V9; analítica de red; IA para atención',
      risks: 'Concentración en pocos sponsors; presión de precio de Amdocs',
      target: '4500000',
      targetCurrency: 'USD',
    }),
  );
  await okData(cm.post(`/account-plans/${plan.id}/approve`));
  await okData(
    am.post(`/accounts/${d.be}/reviews`, {
      kind: 'QUARTERLY',
      periodStart: '2026-07-01',
      heldOn: '2026-10-09',
      findings: 'RutPay estable; hito 2 aceptado; hito 3 en UAT',
      actions: 'Acelerar AC del hito 3; preparar propuesta soporte L3 2027',
    }),
  );
  await okData(
    am.post(`/accounts/${d.wom}/reviews`, {
      kind: 'EDO_MONTHLY',
      periodStart: '2026-10-01',
      heldOn: '2026-11-03',
      findings: '2 incidentes P1 en el mes; 1 con la pelota en WOM',
    }),
  );

  // P11: rate card + CR in progress under a CM exception (shows in "trabajo sin OC")
  await okData(am.post('/rate-cards', { accountId: d.wom, profile: 'Senior Developer', rate: '45', currency: 'USD', validFrom: '2026-01-01' }));
  await okData(am.post('/rate-cards', { accountId: d.wom, profile: 'PM', rate: '60', currency: 'USD', validFrom: '2026-01-01' }));
  const cr = await okData(am.post('/change-requests', { parentContractId: sup.id, title: 'Reporte de portabilidad numérica', description: 'Nuevo reporte diario para Subtel' }));
  await okData(am.put(`/change-requests/${cr.id}/lines`, [{ profile: 'Senior Developer', hours: 120 }, { profile: 'PM', hours: 16 }]));
  await okData(cm.post(`/change-requests/${cr.id}/exception`, { reason: 'Plazo regulatorio Subtel; OC en trámite', expiresOn: '2026-11-30' }));
  await okData(am.post(`/change-requests/${cr.id}/start-work`));
  const cr2 = await okData(am.post('/change-requests', { parentContractId: sup.id, title: 'Ajuste tarificación roaming' }));
  await okData(am.put(`/change-requests/${cr2.id}/lines`, [{ profile: 'Senior Developer', hours: 40 }]));

  // P13: distributors (source: Robotic Work, Grupo IGPS, OnLab)
  const rw = await okData(am.post('/distributors', { name: 'Robotic Work', countryCode: 'CL', status: 'ACTIVE', contactName: 'Gerencia comercial' }));
  await okData(cm.post(`/distributors/${rw.id}/agreements`, { territories: ['CL'], verticals: ['ROBOTICS'], products: 'AgiBot inspección y recepción', marginPct: '0.18', startsOn: '2026-03-01', endsOn: '2027-02-28' }));
  await okData(cm.post(`/distributors/${rw.id}/trainings`, { kind: 'TRAINING', heldOn: '2026-09-18', product: 'AgiBot inspección', attendees: '4 ingenieros' }));
  const igps = await okData(am.post('/distributors', { name: 'Grupo IGPS', countryCode: 'CL', status: 'INACTIVE' }));
  await okData(cm.post(`/distributors/${igps.id}/agreements`, { territories: ['CL'], marginPct: '0.15', startsOn: '2025-06-01', endsOn: '2026-05-31' }));
  await okData(am.post('/distributors', { name: 'OnLab', countryCode: 'CL', status: 'PROSPECT' }));
  await okData(am.post('/deal-registrations', { distributorId: rw.id, accountId: d.gtd, registeredOn: '2026-11-02', notes: 'Robots de inspección para data centers GTD' }));

  // P15: onboarding kits and the AM's checklist
  await okData(cm.put('/onboarding/kits/CL', { items: ['MANUAL', 'TEMPLATES', 'STANDARD_DEMO', 'ACCESS_CRM', 'ACCESS_EDO', 'ACCESS_ZMP', 'ACCESS_FOL'], productiveDays: 30 }));
  await okData(cm.put('/onboarding/kits/CO', { items: ['MANUAL', 'TEMPLATES', 'STANDARD_DEMO', 'ACCESS_CRM', 'ACCESS_ZMP'], productiveDays: 30 }));
  const onb = await okData(cm.post('/onboarding', { userId: ids.clDelivery, countryCode: 'CL', startDate: '2026-09-15' }));
  for (const item of ['MANUAL', 'TEMPLATES', 'ACCESS_CRM', 'ACCESS_EDO']) await okData(cm.patch(`/onboarding/${onb.id}/items/${item}`, { done: true }));

  // P16: resident team PO (WOM OC 4500123, 1 000 h) with two months of ZMP hours → 80 % alert
  await okData(c.clDelivery!.post('/resident-pos', { contractId: d.crContract, poNumber: '4500123', totalHours: '1000', validFrom: '2026-06-01', validTo: '2026-12-31' }));
  await okData(c.clDelivery!.post('/resident-pos/hours-imports', { month: '2026-09-01', csv: 'po_number;resident;hours\n4500123;Residente 1;200\n4500123;Residente 2;195\n' }));
  await okData(c.clDelivery!.post('/resident-pos/hours-imports', { month: '2026-10-01', csv: 'po_number;resident;hours\n4500123;Residente 1;210\n4500123;Residente 2;200\n4500999;Residente 3;16\n' }));

  // P12: two weekly snapshots (W44, W45) so the report shows week-over-week changes
  const cmW44 = await loginInject(app, 'jesus.depablo@example.com', process.env.SEED_DEMO_PASSWORD ?? 'Demo-Password-2026!', '2026-10-28');
  await okData(cmW44.post('/forecast/snapshots'));
  await okData(am.patch(`/opportunities/${d.womV9}/forecast`, { forecastCategory: 'COMMIT' }));
  const cmW45 = await loginInject(app, 'jesus.depablo@example.com', process.env.SEED_DEMO_PASSWORD ?? 'Demo-Password-2026!', '2026-11-04');
  await okData(cmW45.post('/forecast/snapshots'));

  // Worker logic once, so the bell has SLA / collections / renewal / capacity notifications
  for (const job of ['sla.scan', 'collections.daily', 'renewals.daily', 'capacity.daily', 'onboarding.daily'] as const) {
    await runJob(job, app.ctx, d.today);
  }
}
