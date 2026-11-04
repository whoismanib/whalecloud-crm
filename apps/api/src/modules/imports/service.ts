import {
  addDays,
  AccountCreateSchema,
  D,
  edoChangedFields,
  edoIncidentRows,
  escalationSchedule,
  mapEdoIncidents,
  legacyStatusToStage,
  LEGACY_STATUSES,
  mapLegacyTracker,
  matchLegacyInvoice,
  matchOwnerName,
  money,
  parseAmount,
  parseLooseDate,
  type Currency,
  type LegacyStatus,
  type LegacyTrackerData,
  type OpportunityStatus,
} from '@wcrm/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { recordAudit, type Actor } from '../../audit/record';
import type { DbOrTx } from '../../db/client';
import {
  accounts,
  billingEntities,
  collectionActions,
  contacts,
  contracts,
  invoices,
  milestoneBillingLines,
  milestones,
  opportunities,
  opportunityContacts,
  payments,
  stageHistory,
  tickets,
  userRoles,
  users,
} from '../../db/schema/index';
import { AppError } from '../../lib/errors';
import { moneyColumns } from '../../services/money';
import type { RulesContext } from '../../services/rulesContext';

export interface ImportRowError {
  row: number;
  source?: string;
  code: string;
  params?: Record<string, unknown>;
}
export interface ImportReport {
  rowsTotal: number;
  rowsOk: number;
  created: Record<string, number>;
  skipped: number;
  errors: ImportRowError[];
  /** Existing rows changed by the import (eDo upsert). */
  updated?: Record<string, number>;
  /** Rows imported with an assumption. */
  warnings?: ImportRowError[];
}

const newReport = (): ImportReport => ({
  rowsTotal: 0,
  rowsOk: 0,
  created: {},
  skipped: 0,
  errors: [],
});
const bump = (r: ImportReport, k: string) => (r.created[k] = (r.created[k] ?? 0) + 1);

async function defaultEntityId(db: DbOrTx, code = 'WC_CL_SPA') {
  const [b] = await db
    .select({ id: billingEntities.id })
    .from(billingEntities)
    .where(eq(billingEntities.code, code));
  return b?.id ?? null;
}

export async function findOrCreateAccount(
  db: DbOrTx,
  actor: Actor,
  p: { name: string; customerType: 'NEW' | 'EXISTING'; vertical?: string; ownerId?: string },
  report: ImportReport,
) {
  const [a] = await db
    .select()
    .from(accounts)
    .where(sql`lower(${accounts.name}) = lower(${p.name})`)
    .limit(1);
  if (a) return a;
  const [n] = await db
    .insert(accounts)
    .values({
      name: p.name,
      countryCode: 'CL',
      vertical: (p.vertical ?? 'TELECOM_BSS') as 'TELECOM_BSS',
      customerType: p.customerType,
      defaultBillingEntityId: (await defaultEntityId(db))!,
      currency: 'USD',
      ownerId: p.ownerId ?? actor.userId!,
      createdBy: actor.userId,
    })
    .returning();
  bump(report, 'accounts');
  return n!;
}

async function ensureContact(db: DbOrTx, accountId: string, name: string | null) {
  const [first = 'Contacto', ...rest] = (name ?? 'Contacto importado').split(' ');
  const [c] = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.accountId, accountId),
        eq(contacts.firstName, first),
        eq(contacts.lastName, rest.join(' ') || 'importado'),
      ),
    )
    .limit(1);
  if (c) return c;
  const [n] = await db
    .insert(contacts)
    .values({ accountId, firstName: first, lastName: rest.join(' ') || 'importado' })
    .returning();
  return n!;
}

/** Opportunity created by import keeps its stage (data migration) with an IMPORT stage entry. */
export async function createImportedOpportunity(
  db: DbOrTx,
  ctx: RulesContext,
  actor: Actor,
  today: string,
  p: {
    accountId: string;
    name: string;
    vertical: string;
    billingEngine: string;
    origin?: string;
    amount: string;
    currency: Currency;
    expectedCloseDate: string;
    firstContactDate?: string | null;
    stage: number;
    status: OpportunityStatus;
    legacyStatus?: string | null;
    risk?: string | null;
    forecastCategory?: string | null;
    contactName?: string | null;
    competitor?: string | null;
    closeReason?: string | null;
    /** Date the deal was won (legacy PO date); defaults to the import date. */
    wonOn?: string | null;
    /** Owner; defaults to the user running the import. */
    ownerId?: string;
  },
) {
  const seq = await db.execute<{ n: string }>(
    sql`SELECT nextval('opportunity_code_seq')::text AS n`,
  );
  const contact = await ensureContact(db, p.accountId, p.contactName ?? null);
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, p.accountId));
  const won = p.stage >= 7 && p.status === 'OPEN';
  const [o] = await db
    .insert(opportunities)
    .values({
      code: `OPP-${today.slice(0, 4)}-${seq.rows[0]!.n.padStart(4, '0')}`,
      name: p.name,
      accountId: p.accountId,
      ownerId: p.ownerId ?? actor.userId!,
      countryCode: acc!.countryCode,
      vertical: p.vertical as 'TELECOM_BSS',
      billingEngine: p.billingEngine as 'A',
      origin: (p.origin ?? 'OTHER') as 'OTHER',
      stage: p.stage,
      status: p.status,
      ...moneyColumns('amount', p.amount, p.currency, p.expectedCloseDate, ctx.fx),
      expectedCloseDate: p.expectedCloseDate,
      firstContactDate: p.firstContactDate ?? today,
      legacyStatus: p.legacyStatus ?? null,
      risk: (p.risk ?? null) as 'LOW' | null,
      forecastCategory: (won ? 'COMMIT' : (p.forecastCategory ?? 'PIPELINE')) as 'COMMIT',
      countsAsDigital: ctx.settings['digital.verticals'].includes(p.vertical),
      competitors: p.competitor ? [p.competitor] : [],
      customerTypeFrozen: won ? acc!.customerType : null,
      wonAt: won ? new Date(`${p.wonOn ?? today}T12:00:00Z`) : null,
      closedAt: p.status !== 'OPEN' ? new Date() : null,
      closeReason: p.status !== 'OPEN' ? (p.closeReason ?? 'Importado como cerrado') : null,
      createdBy: actor.userId,
    })
    .returning();
  await db.execute(sql`INSERT INTO opportunity_qualifications (opportunity_id) VALUES (${o!.id})`);
  await db
    .insert(opportunityContacts)
    .values({ opportunityId: o!.id, contactId: contact.id, roles: contact.buyingRoles });
  await db.insert(stageHistory).values({
    opportunityId: o!.id,
    toStage: p.stage,
    toStatus: p.status,
    changedBy: actor.userId,
    reason: 'IMPORT (migración de datos)',
  });
  await recordAudit(db, actor, {
    action: 'IMPORT',
    category: 'DATA',
    entityType: 'opportunity',
    entityId: o!.id,
    opportunityId: o!.id,
    accountId: p.accountId,
    changes: [
      { field: 'stage', old: null, new: p.stage },
      { field: 'legacyStatus', old: null, new: p.legacyStatus ?? null },
    ],
  });
  return o!;
}

/** Signed contract for imported won deals; the repository link must be replaced later. */
async function ensureContract(
  db: DbOrTx,
  ctx: RulesContext,
  actor: Actor,
  opp: typeof opportunities.$inferSelect,
  po: { number: string | null; amount: string; signedOn: string },
) {
  const [c] = await db
    .select()
    .from(contracts)
    .where(
      and(eq(contracts.opportunityId, opp.id), sql`${contracts.status} IN ('SIGNED','ACTIVE')`),
    )
    .orderBy(desc(contracts.createdAt))
    .limit(1);
  if (c) return c;
  let number = po.number;
  if (number) {
    // One legacy PO can cover several projects (e.g. 75810). Each project keeps its own contract
    // (so amounts are not double counted); only the first one carries the number, because
    // contracts_account_type_number_uq would otherwise abort the whole import.
    const [same] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(
        and(
          eq(contracts.accountId, opp.accountId),
          eq(contracts.type, 'OC'),
          eq(contracts.number, number),
        ),
      )
      .limit(1);
    if (same) number = null;
  }
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, opp.accountId));
  const [n] = await db
    .insert(contracts)
    .values({
      accountId: opp.accountId,
      opportunityId: opp.id,
      type: 'OC',
      number,
      title: `OC ${po.number ?? ''} — ${opp.name}`.trim(),
      status: 'SIGNED',
      billingEntityId: acc!.defaultBillingEntityId,
      billingEngine: opp.billingEngine,
      signedOn: po.signedOn,
      ...moneyColumns('amount', po.amount, 'USD', po.signedOn, ctx.fx),
      countsForSs: true,
      repositoryUrl: `legacy-import://${opp.code}`,
      createdBy: actor.userId,
    })
    .returning();
  return n!;
}

/** Milestone + billing line + invoice (+ payment, + collection schedule) for imported billing. */
export async function persistInvoice(
  db: DbOrTx,
  ctx: RulesContext,
  actor: Actor,
  opp: typeof opportunities.$inferSelect,
  p: {
    milestoneName: string;
    amount: string;
    currency: Currency;
    receptionOn: string | null;
    number: string | null;
    issuedOn: string | null;
    dueOn: string | null;
    paidAmount?: string | null;
    paidOn?: string | null;
  },
  report: ImportReport,
) {
  const contract = await ensureContract(db, ctx, actor, opp, {
    number: null,
    amount: opp.amountUsd ?? p.amount,
    signedOn: p.issuedOn ?? p.receptionOn ?? opp.expectedCloseDate,
  });
  const [{ seq } = { seq: 0 }] = await db
    .select({ seq: sql<number>`coalesce(max(${milestones.seq}),0)::int` })
    .from(milestones)
    .where(eq(milestones.contractId, contract.id));
  const date = p.issuedOn ?? p.receptionOn ?? opp.expectedCloseDate;
  const invoiced = Boolean(p.number && p.issuedOn);
  const paid = invoiced && p.paidAmount && D(p.paidAmount).gte(D(p.amount));
  const [ms] = await db
    .insert(milestones)
    .values({
      contractId: contract.id,
      opportunityId: opp.id,
      seq: seq + 1,
      name: p.milestoneName,
      ...moneyColumns('amount', p.amount, p.currency, date, ctx.fx),
      billingEngine: opp.billingEngine,
      receptionAt: p.receptionOn,
      recognizedOn: p.receptionOn,
      readyAt: p.receptionOn ? new Date(`${p.receptionOn}T12:00:00Z`) : null,
      status: !invoiced
        ? p.receptionOn
          ? 'ACCEPTED'
          : 'READY'
        : paid
          ? 'PAID'
          : p.paidAmount
            ? 'PARTIALLY_PAID'
            : 'INVOICED',
      createdBy: actor.userId,
    })
    .returning();
  bump(report, 'milestones');
  const [line] = await db
    .insert(milestoneBillingLines)
    .values({
      milestoneId: ms!.id,
      lineNo: 1,
      billingEntityId: contract.billingEntityId,
      description: p.milestoneName,
      ...moneyColumns('amount', p.amount, p.currency, date, ctx.fx),
    })
    .returning();
  if (!invoiced) return;
  const term = ctx.settings['invoices.defaultPaymentTermDays'];
  const dueOn = p.dueOn ?? addDays(p.issuedOn!, term);
  const balance = money(D(p.amount).minus(D(p.paidAmount ?? 0)));
  const [inv] = await db
    .insert(invoices)
    .values({
      billingLineId: line!.id,
      milestoneId: ms!.id,
      accountId: opp.accountId,
      billingEntityId: contract.billingEntityId,
      number: p.number!,
      issuedOn: p.issuedOn!,
      ...moneyColumns('amount', p.amount, p.currency, p.issuedOn!, ctx.fx),
      paymentTermDays: term,
      dueOn,
      balance: D(balance).lt(0) ? '0.00' : balance,
      status: paid ? 'PAID' : p.paidAmount ? 'PARTIALLY_PAID' : 'ISSUED',
      createdBy: actor.userId,
    })
    .returning();
  bump(report, 'invoices');
  if (p.paidAmount && D(p.paidAmount).gt(0)) {
    const paidOn = p.paidOn ?? dueOn;
    await db.insert(payments).values({
      invoiceId: inv!.id,
      paidOn,
      ...moneyColumns(
        'amount',
        D(p.paidAmount).gt(D(p.amount)) ? p.amount : money(p.paidAmount),
        p.currency,
        paidOn,
        ctx.fx,
      ),
      reference: 'IMPORT',
      createdBy: actor.userId,
    });
    bump(report, 'payments');
  }
  if (!paid) {
    for (const e of escalationSchedule(dueOn, ctx.settings)) {
      await db
        .insert(collectionActions)
        .values({
          invoiceId: inv!.id,
          step: e.step,
          scheduledOn: e.scheduledOn,
          responsibleRole: e.responsibleRoles[0]!,
          notifiedRoles: [...e.responsibleRoles.slice(1), ...e.notifyRoles],
          jobKey: `${inv!.id}:${e.step}`,
        })
        .onConflictDoNothing();
    }
  }
}

/** Runs `fn` in a transaction; dry runs roll back and still return the report. */
export async function inTx<T>(
  db: { transaction: DbOrTx['transaction'] },
  dryRun: boolean,
  fn: (tx: DbOrTx) => Promise<T>,
): Promise<T> {
  const ROLLBACK = Symbol('rollback');
  let out: T | undefined;
  try {
    await db.transaction(async (tx) => {
      out = await fn(tx as DbOrTx);
      if (dryRun) throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return out as T;
}

// ---------- CSV importers ----------

export async function importAccounts(
  db: DbOrTx,
  actor: Actor,
  rows: Record<string, string>[],
): Promise<ImportReport> {
  const report = newReport();
  report.rowsTotal = rows.length;
  for (const [i, r] of rows.entries()) {
    const entity = await defaultEntityId(db, r.billingEntityCode || 'WC_CL_SPA');
    const parsed = AccountCreateSchema.safeParse({
      name: r.name,
      legalName: r.legalName || null,
      taxId: r.taxId || null,
      countryCode: r.countryCode || 'CL',
      vertical: r.vertical,
      customerType: r.customerType,
      defaultBillingEntityId: entity,
      currency: r.currency || 'USD',
      isKeyAccount: /^(true|1|si|sí|yes)$/i.test(r.isKeyAccount ?? ''),
    });
    if (!parsed.success) {
      report.errors.push({
        row: i + 2,
        code: 'VALIDATION_ERROR',
        params: { fields: parsed.error.issues.map((x) => x.path.join('.')) },
      });
      continue;
    }
    const [dup] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(sql`lower(${accounts.name}) = lower(${parsed.data.name})`);
    if (dup) {
      report.skipped++;
      continue;
    }
    const [a] = await db
      .insert(accounts)
      .values({ ...parsed.data, ownerId: actor.userId!, createdBy: actor.userId })
      .returning();
    await recordAudit(db, actor, {
      action: 'IMPORT',
      category: 'DATA',
      entityType: 'account',
      entityId: a!.id,
      accountId: a!.id,
    });
    bump(report, 'accounts');
    report.rowsOk++;
  }
  return report;
}

function stageOf(
  r: Record<string, string>,
): { stage: number; status: OpportunityStatus; legacy: string | null } | null {
  if (r.legacyStatus) {
    const ls = LEGACY_STATUSES.find((s) => s.toLowerCase() === r.legacyStatus!.toLowerCase());
    if (!ls) return null;
    const m = legacyStatusToStage(ls as LegacyStatus);
    return { stage: m.stage ?? 3, status: m.status, legacy: ls };
  }
  const s = Number(r.stage || '0');
  return Number.isInteger(s) && s >= 0 && s <= 8
    ? { stage: s, status: 'OPEN', legacy: null }
    : null;
}

export async function importOpportunities(
  db: DbOrTx,
  ctx: RulesContext,
  actor: Actor,
  today: string,
  rows: Record<string, string>[],
) {
  const report = newReport();
  report.rowsTotal = rows.length;
  for (const [i, r] of rows.entries()) {
    const row = i + 2;
    const [acc] = await db
      .select()
      .from(accounts)
      .where(sql`lower(${accounts.name}) = lower(${r.accountName ?? ''})`);
    if (!acc) {
      report.errors.push({ row, code: 'ACCOUNT_NOT_FOUND', params: { name: r.accountName ?? '' } });
      continue;
    }
    const amount = parseAmount(r.amount);
    const close = parseLooseDate(r.expectedCloseDate);
    const st = stageOf(r);
    const engine = (r.billingEngine || '').toUpperCase();
    if (!r.name || !amount || !close || !st || !/^[A-E]$/.test(engine)) {
      report.errors.push({
        row,
        code: !/^[A-E]$/.test(engine) ? 'ENGINE_REQUIRED' : 'VALIDATION_ERROR',
        params: {
          fields: [
            !r.name && 'name',
            !amount && 'amount',
            !close && 'expectedCloseDate',
            !st && 'stage',
          ].filter(Boolean) as string[],
        },
      });
      continue;
    }
    const [dup] = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.accountId, acc.id),
          sql`lower(${opportunities.name}) = lower(${r.name})`,
        ),
      );
    if (dup) {
      report.skipped++;
      continue;
    }
    await createImportedOpportunity(db, ctx, actor, today, {
      accountId: acc.id,
      name: r.name,
      vertical: r.vertical || acc.vertical,
      billingEngine: engine,
      origin: r.origin || 'OTHER',
      amount,
      currency: (r.currency || 'USD').toUpperCase() as Currency,
      expectedCloseDate: close,
      firstContactDate: parseLooseDate(r.firstContactDate),
      stage: st.stage,
      status: st.status,
      legacyStatus: st.legacy,
      risk: r.risk ? r.risk.toUpperCase() : null,
      forecastCategory: r.forecastCategory ? r.forecastCategory.toUpperCase() : null,
      contactName: r.contactName || null,
    });
    bump(report, 'opportunities');
    report.rowsOk++;
  }
  return report;
}

export async function importInvoices(
  db: DbOrTx,
  ctx: RulesContext,
  actor: Actor,
  rows: Record<string, string>[],
) {
  const report = newReport();
  report.rowsTotal = rows.length;
  for (const [i, r] of rows.entries()) {
    const row = i + 2;
    const [opp] = await db
      .select()
      .from(opportunities)
      .where(
        r.opportunityCode
          ? eq(opportunities.code, r.opportunityCode)
          : sql`lower(${opportunities.name}) = lower(${r.opportunityName ?? ''})`,
      )
      .limit(1);
    if (!opp) {
      report.errors.push({
        row,
        code: 'OPPORTUNITY_NOT_FOUND',
        params: { ref: r.opportunityCode || r.opportunityName || '' },
      });
      continue;
    }
    const amount = parseAmount(r.amount);
    const issuedOn = parseLooseDate(r.issuedOn);
    if (!r.number || !amount || !issuedOn) {
      report.errors.push({
        row,
        code: 'VALIDATION_ERROR',
        params: {
          fields: [!r.number && 'number', !amount && 'amount', !issuedOn && 'issuedOn'].filter(
            Boolean,
          ) as string[],
        },
      });
      continue;
    }
    const [dup] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.number, r.number));
    if (dup) {
      report.skipped++;
      continue;
    }
    await persistInvoice(
      db,
      ctx,
      actor,
      opp,
      {
        milestoneName: r.milestoneName || `Factura ${r.number}`,
        amount,
        currency: (r.currency || 'USD').toUpperCase() as Currency,
        receptionOn: parseLooseDate(r.receptionOn) ?? issuedOn,
        number: r.number,
        issuedOn,
        dueOn: parseLooseDate(r.dueOn),
        paidAmount: parseAmount(r.paidAmount),
        paidOn: parseLooseDate(r.paidOn),
      },
      report,
    );
    report.rowsOk++;
  }
  return report;
}

/** Legacy `tracker_data.json` (wom[], new_clients[], billing[]) → accounts, opportunities, contracts, billing. */
export async function importLegacyTracker(
  db: DbOrTx,
  ctx: RulesContext,
  actor: Actor,
  today: string,
  data: LegacyTrackerData,
) {
  const report = newReport();
  const mapped = mapLegacyTracker(data, { importDate: today });
  report.rowsTotal =
    (data.wom?.length ?? 0) + (data.new_clients?.length ?? 0) + (data.billing?.length ?? 0);
  report.errors.push(
    ...mapped.failures.map((f) => ({
      row: f.row,
      source: f.source,
      code: f.code,
      params: f.params ?? undefined,
    })),
  );
  // Owners: the tracker's "pic" when it is a CRM user with a business role (ADMIN never owns
  // business records, ARCHITECTURE §6.3); else the account owner; else whoever imports.
  const roleRows = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email, role: userRoles.role })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(eq(users.isActive, true));
  const businessUsers = [
    ...new Map(roleRows.filter((u) => u.role !== 'ADMIN').map((u) => [u.id, u])).values(),
  ];
  const businessIds = new Set(businessUsers.map((u) => u.id));
  for (const o of mapped.opportunities) {
    const picOwner = matchOwnerName(o.ownerName, businessUsers)?.id;
    const acc = await findOrCreateAccount(
      db,
      actor,
      { name: o.accountName, customerType: o.customerType, ownerId: picOwner },
      report,
    );
    const ownerId = picOwner ?? (businessIds.has(acc.ownerId) ? acc.ownerId : actor.userId!);
    // Same name in different years is a different project (BSS Support L3 2026 vs 2027).
    const [dup] = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.accountId, acc.id),
          sql`lower(${opportunities.name}) = lower(${o.name})`,
          eq(opportunities.expectedCloseDate, o.expectedCloseDate),
        ),
      );
    if (dup) {
      report.skipped++;
      continue;
    }
    const opp = await createImportedOpportunity(db, ctx, actor, today, {
      accountId: acc.id,
      name: o.name,
      vertical: acc.vertical,
      billingEngine: o.billingEngine,
      amount: o.amountUsd,
      currency: 'USD',
      expectedCloseDate: o.expectedCloseDate,
      stage: o.stage,
      status: o.status,
      legacyStatus: o.legacyStatus,
      risk: o.risk,
      competitor: o.competitor,
      closeReason: o.status !== 'OPEN' ? `Estado legado: ${o.legacyStatus ?? 'Cancelled'}` : null,
      wonOn: o.wonOn,
      ownerId,
    });
    bump(report, 'opportunities');
    if (o.stage >= 7 && o.status === 'OPEN') {
      await ensureContract(db, ctx, actor, opp, {
        number: o.poNumber,
        amount: o.poAmountUsd ?? o.amountUsd,
        signedOn: o.wonOn ?? today,
      });
      bump(report, 'contracts');
    }
    report.rowsOk++;
  }
  // Candidates for billing rows: every opportunity, with the year its PO counts in.
  const candidates = (await db.select().from(opportunities)).map((o) => ({
    name: o.name,
    year: Number((o.wonAt ? o.wonAt.toISOString() : String(o.expectedCloseDate)).slice(0, 4)),
    opp: o,
  }));
  for (const inv of mapped.invoices) {
    const hit = matchLegacyInvoice(inv.projectName, inv.yearHint, candidates);
    if (!hit) {
      report.errors.push({
        row: inv.row,
        source: 'billing',
        code: 'OPPORTUNITY_NOT_FOUND',
        params: { ref: inv.projectName },
      });
      continue;
    }
    const opp = hit.opp;
    if (inv.invoiceNumber) {
      const [dup] = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.number, inv.invoiceNumber));
      if (dup) {
        report.skipped++;
        continue;
      }
    } else {
      // Not invoiced yet: idempotent on (opportunity, milestone name).
      const [dup] = await db
        .select({ id: milestones.id })
        .from(milestones)
        .where(and(eq(milestones.opportunityId, opp.id), eq(milestones.name, inv.projectName)));
      if (dup) {
        report.skipped++;
        continue;
      }
    }
    await persistInvoice(
      db,
      ctx,
      actor,
      opp,
      {
        milestoneName: inv.projectName,
        amount: inv.amountUsd,
        currency: 'USD',
        receptionOn: inv.receptionOn,
        number: inv.invoiceNumber,
        issuedOn: inv.invoiceNumber ? (inv.issuedOn ?? inv.receptionOn ?? today) : null,
        dueOn: inv.dueOn,
        paidAmount: inv.payStatus === 'PAID' ? inv.amountUsd : null,
        paidOn: inv.payStatus === 'PAID' ? inv.dueOn : null,
      },
      report,
    );
    report.rowsOk++;
  }
  return report;
}

// ---------- eDo incidents (legacy edo_incidents.json) ----------

const EDO = 'EDO';

/**
 * Idempotent upsert of eDo incidents into `tickets`, keyed by the eDo `issueId`
 * (`external_source = 'EDO'`, `external_id`). A manual ticket of the same account with the
 * same number and no external id is linked instead of duplicated. Unchanged tickets are
 * skipped; `notes` (CRM-only) is never touched.
 */
export async function importEdoIncidents(
  db: DbOrTx,
  actor: Actor,
  data: unknown,
  opts: { accountId?: string; accountName: string; timeZone: string },
): Promise<ImportReport> {
  const report = newReport();
  report.updated = {};
  const rows = edoIncidentRows(data) ?? [];
  report.rowsTotal = rows.length;
  const mapped = mapEdoIncidents(rows, { timeZone: opts.timeZone });
  report.errors.push(
    ...mapped.failures.map((f) => ({ row: f.row, source: 'eDo', code: f.code, params: f.params })),
  );
  report.warnings = mapped.warnings.map((w) => ({
    row: w.row,
    source: 'eDo',
    code: w.code,
    params: w.params,
  }));
  report.rowsOk = rows.length - mapped.failures.length;
  report.skipped += mapped.duplicates;
  if (!mapped.tickets.length) return report;

  let account: { id: string } | undefined;
  if (opts.accountId) {
    [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, opts.accountId));
    if (!account) throw new AppError(404, 'NOT_FOUND');
  } else {
    account = await findOrCreateAccount(
      db,
      actor,
      { name: opts.accountName, customerType: 'EXISTING' },
      report,
    );
  }

  const cols = {
    id: tickets.id,
    rowVersion: tickets.rowVersion,
    number: tickets.number,
    title: tickets.title,
    priority: tickets.priority,
    status: tickets.status,
    ballIn: tickets.ballIn,
    orgHolder: tickets.orgHolder,
    ownerName: tickets.ownerName,
    slaDueOn: tickets.slaDueOn,
    openedOn: tickets.openedOn,
    lastUpdateAt: tickets.lastUpdateAt,
    closedOn: tickets.closedOn,
    externalUrl: tickets.externalUrl,
    externalId: tickets.externalId,
  };
  const byExternal = new Map(
    (await db.select(cols).from(tickets).where(eq(tickets.externalSource, EDO))).map((t) => [
      t.externalId!,
      t,
    ]),
  );
  const manualByNumber = new Map<string, { id: string; rowVersion: number }[]>();
  for (const t of await db
    .select(cols)
    .from(tickets)
    .where(and(eq(tickets.accountId, account.id), sql`${tickets.externalId} IS NULL`))) {
    manualByNumber.set(t.number, [...(manualByNumber.get(t.number) ?? []), t]);
  }

  const fields = (d: (typeof mapped.tickets)[number]) => ({
    number: d.number,
    title: d.title,
    priority: d.priority,
    status: d.status,
    ballIn: d.ballIn,
    orgHolder: d.orgHolder,
    ownerName: d.ownerName,
    slaDueOn: d.slaDueOn,
    openedOn: d.openedOn,
    lastUpdateAt: new Date(d.lastUpdateAt),
    closedOn: d.closedOn,
    externalUrl: d.externalUrl,
  });
  const inserts: (typeof tickets.$inferInsert)[] = [];
  for (const d of mapped.tickets) {
    const current = byExternal.get(d.externalId);
    const manual = current ? undefined : manualByNumber.get(d.number)?.shift();
    const target = current ?? manual;
    if (!target) {
      inserts.push({
        ...fields(d),
        accountId: account.id,
        externalSource: EDO,
        externalId: d.externalId,
        createdBy: actor.userId,
      });
      continue;
    }
    if (current && !edoChangedFields(current, d).length) {
      report.skipped++;
      continue;
    }
    await db
      .update(tickets)
      .set({
        ...fields(d),
        externalSource: EDO,
        externalId: d.externalId,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        rowVersion: target.rowVersion + 1,
      })
      .where(eq(tickets.id, target.id));
    report.updated[current ? 'tickets' : 'ticketsLinked'] =
      (report.updated[current ? 'tickets' : 'ticketsLinked'] ?? 0) + 1;
  }
  for (let i = 0; i < inserts.length; i += 500) {
    await db.insert(tickets).values(inserts.slice(i, i + 500));
  }
  if (inserts.length) report.created.tickets = inserts.length;
  return report;
}
