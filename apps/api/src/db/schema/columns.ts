import { boolean, date, integer, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';
import { currencyCode } from './enums';

// Column helpers. Names are derived from TS keys (drizzle `casing: 'snake_case'`).

/** +BASE columns (DATA-MODEL §1). FKs to users are declared per table where needed. */
export const base = () => ({
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid(),
  updatedBy: uuid(),
  rowVersion: integer().notNull().default(1),
});

export const dec = () => numeric({ precision: 18, scale: 2 });
export const frac = () => numeric({ precision: 7, scale: 6 });
export const pct = () => numeric({ precision: 5, scale: 2 });

const cur = () => currencyCode();
const clp = () => numeric({ precision: 18, scale: 0 });
const fxMonth = () => date();
const prov = () => boolean().notNull().default(false);

type MoneyCols<P extends string> = { [K in P]: ReturnType<typeof dec> } & {
  [K in `${P}Currency`]: ReturnType<typeof cur>;
} & { [K in `${P}Usd` | `${P}Cny`]: ReturnType<typeof dec> } & {
  [K in `${P}Clp`]: ReturnType<typeof clp>;
} & { [K in `${P}FxMonth`]: ReturnType<typeof fxMonth> } & {
  [K in `${P}FxProvisional`]: ReturnType<typeof prov>;
};

/** +MONEY(p): amount, currency and USD/CNY/CLP equivalents with FX month (DATA-MODEL §1). */
export function money<P extends string>(p: P): MoneyCols<P> {
  return {
    [p]: dec(),
    [`${p}Currency`]: cur(),
    [`${p}Usd`]: dec(),
    [`${p}Cny`]: dec(),
    [`${p}Clp`]: clp(),
    [`${p}FxMonth`]: fxMonth(),
    [`${p}FxProvisional`]: prov(),
  } as MoneyCols<P>;
}
