import { expect, test } from '@playwright/test';
import {
  apiOf,
  data,
  errorCodes,
  findOpportunity,
  lineAt,
  login,
  openOpportunity,
  qualification,
} from './support/helpers';
import { loadSheet, newOpportunity, qualifyTo, submitPriceRequest } from './support/flows';

/** Gate rejections (BACKLOG P2-02, P2-03, P4-01, P6-02, P7-02). */
test.describe('stage gates', () => {
  test('P2-03: no price request without economic buyer (seeded Coopeuch)', async ({ page }) => {
    await login(page, 'am');
    const o = await findOpportunity(page, 'Coopeuch — Billetera digital Alipay+');
    await openOpportunity(page, o.id);
    const gate = page.getByTestId('next-gate');
    await expect(gate).toContainText('Para avanzar a «4 Precio solicitado» falta:');
    await expect(gate).toContainText('No se pide precio sin comprador económico');
    await page.getByTestId('advance-btn').click();
    await expect(page.getByTestId('rule-errors')).toContainText('comprador económico');
    const api = await apiOf(page);
    const r = await api.post(`/opportunities/${o.id}/transitions`, { toStage: 4 });
    expect(r.status()).toBe(422);
    expect(await errorCodes(r)).toContain('ECONOMIC_BUYER_MISSING');
    expect((await data(api.get(`/opportunities/${o.id}`))).stage).toBe(3);
  });

  test('P2-02: MEDDPICC < 50 % blocks stage 2 above USD 500.000, not below', async ({ page }) => {
    await login(page, 'am');
    const big = await newOpportunity(page, { amount: '600000' });
    await qualifyTo(page, big, 1, 3); // 3/8 = 37,5 %
    await openOpportunity(page, big.oppId);
    await expect(page.getByTestId('next-gate')).toContainText('MEDDPICC bajo el 50 %');
    await page.getByTestId('advance-btn').click();
    await expect(page.getByTestId('rule-errors')).toContainText('MEDDPICC bajo el 50 %');

    const api = await apiOf(page);
    await data(api.put(`/opportunities/${big.oppId}/qualification`, qualification(4)));
    await page.reload();
    await expect(page.getByTestId('next-gate')).toContainText(
      'Cumple los requisitos para avanzar a «2 Descubrimiento»',
    );

    const small = await newOpportunity(page, { amount: '500000' }); // ≤ 500k → optional
    await qualifyTo(page, small, 2, 0);
    expect((await data(api.get(`/opportunities/${small.oppId}`))).stage).toBe(2);
  });

  test('P4-01: business case required above USD 2 MM before the proposal', async ({ page }) => {
    await login(page, 'am');
    const s = await newOpportunity(page, { amount: '2500000' });
    await qualifyTo(page, s, 3, 4);
    const prId = await submitPriceRequest(page, s, '2500000');
    // all lines above target → committee band, but the amount alone requires a business case
    await loadSheet(page, prId, [
      lineAt(1, 'OWN_SOFTWARE', 1500000, 0.7),
      lineAt(2, 'IMPLEMENTATION', 1000000, 0.65),
    ]);
    await login(page, 'am');
    await openOpportunity(page, s.oppId, 'Aprobación');
    await expect(page.getByTestId('approval-preview')).toContainText('Comité de precios China');
    const api = await apiOf(page);
    const gate = await data(api.get(`/opportunities/${s.oppId}/gates?toStage=5`));
    expect(gate.failures.map((f: { code: string }) => f.code)).toContain('BUSINESS_CASE_REQUIRED');
  });

  test('P7-02: cash flow ≠ T&C is detected and blocks the proposal (seeded Equifiber)', async ({
    page,
  }) => {
    await login(page, 'am');
    const o = await findOpportunity(page, 'Equifiber — OSS fase 1');
    await openOpportunity(page, o.id, 'Líneas y margen');
    await expect(page.getByText('Flujo de caja ≠ T&C', { exact: false })).toBeVisible();
    await expect(page.getByText('Flujo de caja (A3): 20 / 20 / 50 / 10')).toBeVisible();
    await expect(page.getByText('T&C: 30 / 50 / 20')).toBeVisible();
    // source document: 58,0 % net-income margin and 50,3 % contract margin → Jacky (VP)
    const totals = page.getByRole('row', { name: /Totales/ });
    await expect(totals).toContainText('58,0%');
    await expect(totals).toContainText('50,3%');
    await expect(page.getByText('Jacky (VP)').first()).toBeVisible();
    const gate = await data((await apiOf(page)).get(`/opportunities/${o.id}/gates?toStage=5`));
    const mismatch = gate.failures.find((f: { code: string }) => f.code === 'CASHFLOW_TC_MISMATCH');
    expect(mismatch?.params).toMatchObject({
      cashflow: '20.00/20.00/50.00/10.00',
      tc: '30.00/50.00/20.00',
    });
  });

  test('P6-02: a line below 50 % cannot be quoted nor sent to approval', async ({ page }) => {
    await login(page, 'am');
    const s = await newOpportunity(page, { amount: '900000' });
    await qualifyTo(page, s, 3, 4);
    const prId = await submitPriceRequest(page, s, '900000');
    const sheet = await loadSheet(page, prId, [
      lineAt(1, 'OWN_SOFTWARE', 500000, 0.7),
      lineAt(2, 'IMPLEMENTATION', 400000, 0.48),
    ]);
    expect(sheet.proposedBand).toBe('NOT_QUOTABLE');
    await login(page, 'am');
    await openOpportunity(page, s.oppId, 'Aprobación');
    await expect(page.getByTestId('approval-preview')).toContainText('No se cotiza (< 50 %)');
    await expect(page.getByTestId('request-approval')).toHaveCount(0);
    const r = await (await apiOf(page)).post(`/sheet-versions/${sheet.id}/approval-requests`, {});
    expect(r.status()).toBe(422);
    expect(await errorCodes(r)).toEqual(['NOT_QUOTABLE_BELOW_50']);
  });
});
