import {
  CL_CALENDAR,
  CN_CALENDAR,
  DEFAULT_RACI,
  DEFAULT_SETTINGS,
  PROCESS_CODES,
  USER_ROLES,
  type UserRole,
} from '@wcrm/shared';
import { eq } from 'drizzle-orm';
import type { Config } from '../../config';
import { hashPassword } from '../../auth/crypto';
import type { Db } from '../client';
import {
  billingEntities,
  calendars,
  countries,
  fxRates,
  holidays,
  raciEntries,
  raciVersions,
  settings,
  targets,
  userRoles,
  users,
} from '../schema/index';

/** Example monthly FX (units per USD). Source "seed"; China Finance replaces them (CORE-04). */
const FX: Record<string, { CNY: string; CLP: string }> = {
  '2026-01-01': { CNY: '7.1800', CLP: '958' },
  '2026-02-01': { CNY: '7.1700', CLP: '951' },
  '2026-03-01': { CNY: '7.1600', CLP: '947' },
  '2026-04-01': { CNY: '7.1500', CLP: '944' },
  '2026-05-01': { CNY: '7.1400', CLP: '941' },
  '2026-06-01': { CNY: '7.1300', CLP: '938' },
  '2026-07-01': { CNY: '7.1200', CLP: '940' },
  '2026-08-01': { CNY: '7.1100', CLP: '942' },
  '2026-09-01': { CNY: '7.1000', CLP: '939' },
  '2026-10-01': { CNY: '7.1000', CLP: '936' },
  '2026-11-01': { CNY: '7.0900', CLP: '935' },
};

export async function upsertUser(
  db: Db,
  config: Config,
  u: {
    email: string;
    fullName: string;
    password: string;
    roles: UserRole[];
    locale?: string;
    timezone?: string;
    calendarId?: string;
    countryCodes?: string[];
  },
): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, u.email));
  let id = existing?.id;
  if (!id) {
    const [row] = await db
      .insert(users)
      .values({
        email: u.email,
        fullName: u.fullName,
        passwordHash: await hashPassword(u.password, {
          memoryCost: config.ARGON2_MEMORY_KIB,
          timeCost: config.ARGON2_TIME_COST,
        }),
        locale: u.locale ?? 'es-CL',
        timezone: u.timezone ?? 'America/Santiago',
        calendarId: u.calendarId ?? 'CL',
        countryCodes: u.countryCodes ?? ['CL'],
      })
      .returning({ id: users.id });
    id = row!.id;
  }
  for (const role of u.roles) {
    await db.insert(userRoles).values({ userId: id, role }).onConflictDoNothing();
  }
  return id;
}

/** Idempotent base data: calendars, countries, entities, RACI v1, settings, targets, FX, admin. */
export async function seedBase(db: Db, config: Config): Promise<void> {
  for (const cal of [CL_CALENDAR, CN_CALENDAR]) {
    await db
      .insert(calendars)
      .values({ id: cal.id, name: cal.name, timezone: cal.timezone, weekendDays: cal.weekend })
      .onConflictDoNothing();
    for (const h of cal.holidays) {
      await db
        .insert(holidays)
        .values({ calendarId: cal.id, date: h.date, name: h.name })
        .onConflictDoNothing();
    }
    for (const d of cal.extraWorkdays) {
      await db
        .insert(holidays)
        .values({ calendarId: cal.id, date: d, name: '调休 (día laboral)', isWorkday: true })
        .onConflictDoNothing();
    }
  }

  const cs = [
    {
      code: 'CL',
      nameEs: 'Chile',
      nameEn: 'Chile',
      nameZh: '智利',
      defaultCurrency: 'CLP',
      calendarId: 'CL',
      vatPct: '0.190000',
    },
    {
      code: 'CN',
      nameEs: 'China',
      nameEn: 'China',
      nameZh: '中国',
      defaultCurrency: 'CNY',
      calendarId: 'CN',
      vatPct: '0.130000',
    },
    {
      code: 'CO',
      nameEs: 'Colombia',
      nameEn: 'Colombia',
      nameZh: '哥伦比亚',
      defaultCurrency: 'COP',
      calendarId: 'CL',
      vatPct: '0.190000',
    },
    {
      code: 'MX',
      nameEs: 'México',
      nameEn: 'Mexico',
      nameZh: '墨西哥',
      defaultCurrency: 'MXN',
      calendarId: 'CL',
      vatPct: '0.160000',
    },
    {
      code: 'BO',
      nameEs: 'Bolivia',
      nameEn: 'Bolivia',
      nameZh: '玻利维亚',
      defaultCurrency: 'BOB',
      calendarId: 'CL',
      vatPct: '0.130000',
    },
    {
      code: 'SG',
      nameEs: 'Singapur',
      nameEn: 'Singapore',
      nameZh: '新加坡',
      defaultCurrency: 'USD',
      calendarId: 'CN',
      vatPct: '0.090000',
    },
  ] as const;
  for (const c of cs) await db.insert(countries).values(c).onConflictDoNothing();

  const bes = [
    {
      code: 'WC_CL_SPA',
      legalName: 'Whale Cloud Technology Chile SpA',
      countryCode: 'CL',
      vatPct: '0.190000',
      withholdingPct: '0.100000',
      currency: 'CLP',
    },
    {
      code: 'WC_CN',
      legalName: 'Whale Cloud Technology Co., Ltd. (China)',
      countryCode: 'CN',
      vatPct: '0.000000',
      withholdingPct: '0.100000',
      currency: 'USD',
    },
    {
      code: 'WC_SG',
      legalName: 'Whale Cloud Technology Singapore Pte. Ltd.',
      countryCode: 'SG',
      vatPct: '0.000000',
      withholdingPct: '0.100000',
      currency: 'USD',
    },
  ] as const;
  for (const b of bes) await db.insert(billingEntities).values(b).onConflictDoNothing();

  // RACI v1 (ARCHITECTURE §6.3)
  const [v1] = await db.select().from(raciVersions).where(eq(raciVersions.version, 1));
  if (!v1) {
    const [rv] = await db
      .insert(raciVersions)
      .values({ version: 1, isActive: true, comment: 'RACI por defecto (fuente + PRD §3)' })
      .returning();
    for (const p of PROCESS_CODES) {
      for (const role of USER_ROLES) {
        await db.insert(raciEntries).values({
          raciVersionId: rv!.id,
          process: p,
          role,
          letters: DEFAULT_RACI[p]?.[role] ?? [],
        });
      }
    }
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(settings).values({ key, value }).onConflictDoNothing();
  }

  const tg = [
    { kpiCode: 'SS_SIGNED', segment: 'TOTAL', value: '200', unit: 'MM_CNY' },
    { kpiCode: 'SS_SIGNED', segment: 'NEW', value: '100', unit: 'MM_CNY' },
    { kpiCode: 'SS_SIGNED', segment: 'EXISTING', value: '100', unit: 'MM_CNY' },
    { kpiCode: 'PAYMENTS', segment: 'TOTAL', value: '150', unit: 'MM_CNY' },
    { kpiCode: 'PROFIT', segment: 'TOTAL', value: null, unit: 'MM_CNY' },
    { kpiCode: 'DIGITAL_SALES', segment: 'TOTAL', value: null, unit: 'MM_CNY' },
    { kpiCode: 'COVERAGE', segment: 'TOTAL', value: '3', unit: 'RATIO' },
  ];
  for (const t of tg)
    await db
      .insert(targets)
      .values({ ...t, year: 2026 })
      .onConflictDoNothing();

  for (const [month, r] of Object.entries(FX)) {
    for (const currency of ['CNY', 'CLP'] as const) {
      await db
        .insert(fxRates)
        .values({ month, currency, unitsPerUsd: r[currency], kind: 'ACTUAL', source: 'seed' })
        .onConflictDoNothing();
    }
    await db
      .insert(fxRates)
      .values({ month, currency: 'USD', unitsPerUsd: '1', kind: 'ACTUAL', source: 'seed' })
      .onConflictDoNothing();
  }

  await upsertUser(db, config, {
    email: config.SEED_ADMIN_EMAIL,
    fullName: 'Administrador CRM',
    password: config.SEED_ADMIN_PASSWORD,
    roles: ['ADMIN'],
    countryCodes: ['*'],
  });
}
