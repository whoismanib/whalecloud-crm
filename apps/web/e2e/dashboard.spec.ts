import { expect, test } from '@playwright/test';
import pg from 'pg';
import { e2eDbUrl, login, todayCl } from './support/helpers';

/**
 * DASH-01 / KPIS.md §3: the Resumen KPIs equal an independent SQL computation over the seeded
 * database (contracts, payments, invoices), so a regression in the KPI engine or in the seed is
 * caught. Expected values are computed at run time because other specs add records.
 */
const mm = (v: number, digits = 1) =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: digits }).format(v / 1_000_000);

test('Resumen KPIs match the seeded data (CNY)', async ({ page }) => {
  const today = todayCl();
  const year = today.slice(0, 4);
  const db = new pg.Client({ connectionString: e2eDbUrl() });
  await db.connect();
  const one = async (q: string, p: unknown[] = []) => (await db.query(q, p)).rows[0];
  let ss: number, payments: number, overdue: { n: number; amt: number }, toCollect: number;
  try {
    ss = Number(
      (
        await one(
          `SELECT coalesce(sum(c.amount_cny),0) v FROM contracts c
             JOIN opportunities o ON o.id = c.opportunity_id
            WHERE c.counts_for_ss AND c.type <> 'NDA' AND c.signed_on BETWEEN $1 AND $2
              AND o.stage >= 7 AND o.status = 'OPEN'`,
          [`${year}-01-01`, today],
        )
      ).v,
    );
    payments = Number(
      (
        await one(
          `SELECT coalesce(sum(amount_cny),0) v FROM payments WHERE paid_on BETWEEN $1 AND $2`,
          [`${year}-01-01`, today],
        )
      ).v,
    );
    const o = await one(
      `SELECT count(*)::int n, coalesce(sum(amount_cny * balance / amount),0) amt FROM invoices
        WHERE balance > 0 AND due_on < ($1::date - 30)`,
      [today],
    );
    overdue = { n: o.n, amt: Number(o.amt) };
    toCollect = Number(
      (
        await one(
          `SELECT coalesce(sum(amount_cny * balance / amount),0) v FROM invoices WHERE balance > 0`,
        )
      ).v,
    );
  } finally {
    await db.end();
  }
  expect(ss).toBeGreaterThan(30_000_000); // seed: BancoEstado RutPay SOW + WOM CR OC

  await login(page, 'cm');
  await expect(page.getByTestId('kpi-grid')).toBeVisible();
  await expect(page.getByTestId('kpi-SS_SIGNED')).toContainText(`${mm(ss)}MM CNY`);
  await expect(page.getByTestId('kpi-SS_SIGNED')).toContainText('Meta: 200');
  await expect(page.getByTestId('kpi-PAYMENTS')).toContainText(`${mm(payments)}MM CNY`);
  await expect(page.getByTestId('kpi-PAYMENTS')).toContainText('Meta: 150');
  await expect(page.getByTestId('kpi-OVERDUE_RECEIVABLES')).toContainText(`${overdue.n}Meta: 0`);
  await expect(page.getByTestId('kpi-OVERDUE_RECEIVABLES')).toContainText(
    `Monto ${mm(overdue.amt)} MM`,
  );
  await expect(page.getByTestId('kpi-PROFIT')).toContainText('según China');
  const cards = page.getByTestId('legacy-cards');
  const clp = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(
    Math.round(toCollect),
  );
  // legacy card "Por cobrar" = open invoice balances in CNY
  await expect(cards).toContainText(new RegExp(`Por cobrar\\s*CNY\\s${clp.replace(/\./g, '\\.')}`));

  // DASH-03: display currency switch
  await page.getByText('USD', { exact: true }).first().click();
  await expect(page.getByTestId('kpi-SS_SIGNED')).toContainText('MM USD');
});
