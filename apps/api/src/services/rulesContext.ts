import {
  DEFAULT_RACI,
  resolveSettings,
  type BusinessCalendar,
  type FxRate,
  type Raci,
  type Settings,
} from '@wcrm/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  calendars,
  fxRates,
  holidays,
  raciEntries,
  raciVersions,
  settings,
} from '../db/schema/index';

export interface RulesContext {
  settings: Settings;
  calendars: Record<string, BusinessCalendar>;
  fx: FxRate[];
  raci: Raci;
  raciVersion: number;
}

/**
 * Loads the parameters the pure rules need (settings, business calendars, FX table, RACI)
 * with a small in-process cache (ARCHITECTURE §6.4: 60 s).
 */
export class RulesContextService {
  private cache: { at: number; value: RulesContext } | null = null;

  constructor(
    private readonly db: Db,
    private readonly ttlMs = 60_000,
  ) {}

  invalidate(): void {
    this.cache = null;
  }

  async get(): Promise<RulesContext> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.value;
    const [settingRows, calRows, holRows, fxRows, raciRow] = await Promise.all([
      this.db.select().from(settings),
      this.db.select().from(calendars),
      this.db.select().from(holidays),
      this.db.select().from(fxRates).where(eq(fxRates.kind, 'ACTUAL')),
      this.db.select().from(raciVersions).where(eq(raciVersions.isActive, true)).limit(1),
    ]);
    const stored: Record<string, unknown> = {};
    for (const s of settingRows) stored[s.key] = s.value;
    const cals: Record<string, BusinessCalendar> = {};
    for (const c of calRows) {
      cals[c.id] = {
        weekend: c.weekendDays,
        holidays: new Set(
          holRows.filter((h) => h.calendarId === c.id && !h.isWorkday).map((h) => h.date),
        ),
        extraWorkdays: new Set(
          holRows.filter((h) => h.calendarId === c.id && h.isWorkday).map((h) => h.date),
        ),
      };
    }
    if (!cals.CL) cals.CL = { weekend: [0, 6], holidays: new Set() };
    if (!cals.CN) cals.CN = { weekend: [0, 6], holidays: new Set() };

    let raci: Raci = DEFAULT_RACI;
    let raciVersion = 0;
    const active = raciRow[0];
    if (active) {
      const entries = await this.db
        .select()
        .from(raciEntries)
        .where(and(eq(raciEntries.raciVersionId, active.id)));
      raci = {};
      for (const e of entries) {
        raci[e.process] = { ...(raci[e.process] ?? {}), [e.role]: e.letters };
      }
      raciVersion = active.version;
    }
    const value: RulesContext = {
      settings: resolveSettings(stored),
      calendars: cals,
      fx: fxRows.map((r) => ({ month: r.month, currency: r.currency, unitsPerUsd: r.unitsPerUsd })),
      raci,
      raciVersion,
    };
    this.cache = { at: Date.now(), value };
    return value;
  }
}
