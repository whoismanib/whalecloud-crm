import { expect, test } from '@playwright/test';
import { apiOf, data, findOpportunity, login, openOpportunity, type Who } from './support/helpers';

/** ADM-02 permissions derived from the RACI (+ action roles). */
test.describe('RBAC', () => {
  test('only China Finance can register an invoice (P8-05)', async ({ page }) => {
    await login(page, 'finance');
    const fin = await apiOf(page);
    const bancoEstado = await findOpportunity(page, 'BancoEstado — RutPay fase 3');
    const milestones = await data(fin.get(`/milestones?opportunityId=${bancoEstado.id}`));
    const lineId: string = milestones[0].billingLines[0].id;
    // the guard lets China Finance through (empty body → 400 validation, not 403)
    expect((await fin.post(`/milestone-billing-lines/${lineId}/invoices`, {})).status()).toBe(400);
    for (const who of ['am', 'cm', 'clDelivery', 'president'] as Who[]) {
      await login(page, who);
      const r = await (await apiOf(page)).post(`/milestone-billing-lines/${lineId}/invoices`, {});
      expect(r.status(), who).toBe(403);
    }
  });

  test('Account Manager has no approval inbox items nor admin access', async ({ page }) => {
    await login(page, 'am');
    await page.getByRole('link', { name: 'Aprobaciones' }).click();
    await expect(page.getByText('Sin registros')).toBeVisible();
    const api = await apiOf(page);
    expect((await api.get('/admin/users')).status()).toBe(403);
    expect((await api.get('/audit-log')).status()).toBe(403);
    // seeded WOM V9 approval was decided by Alex Xiao: an AM cannot decide approval steps
    const wom = await findOpportunity(page, 'WOM — Upgrade ZSmart BSS V9');
    const [req] = await data(api.get(`/opportunities/${wom.id}/approval-requests`));
    expect(req.band).toBe('PRESIDENT');
    const r = await api.post(`/approval-steps/${req.steps[0].id}/decision`, {
      decision: 'APPROVED',
    });
    expect([403, 409, 422]).toContain(r.status());
    expect(r.status()).not.toBe(200);
  });

  test('China Legal (— in P1) does not see stage-0 opportunities (ADM-02)', async ({ page }) => {
    await login(page, 'cm');
    const lead = await findOpportunity(page, 'GTD — Energy Optimizer para data centers');
    await login(page, 'legal');
    const api = await apiOf(page);
    const list: { id: string; stage: number }[] = await data(api.get('/opportunities'));
    expect(list.some((o) => o.stage === 0)).toBe(false);
    expect((await api.get(`/opportunities/${lead.id}`)).status()).toBe(404);
    await page.goto(`/oportunidades/${lead.id}`);
    await expect(page.getByTestId('opp-title')).toHaveCount(0);
  });

  test('Jacky (I in P5) can read but not edit a price request', async ({ page }) => {
    await login(page, 'vp');
    const api = await apiOf(page);
    const prs: { id: string }[] = await data(api.get('/price-requests'));
    expect(prs.length).toBeGreaterThan(0);
    expect((await api.get(`/price-requests/${prs[0]!.id}`)).status()).toBe(200);
    expect((await api.patch(`/price-requests/${prs[0]!.id}`, { summary: 'x' })).status()).toBe(403);
  });

  test('Account Manager does not see invoice/payment actions in the UI', async ({ page }) => {
    await login(page, 'am');
    const o = await findOpportunity(page, 'BancoEstado — RutPay fase 3');
    await openOpportunity(page, o.id, 'Hitos');
    await expect(page.getByTestId('milestones-table')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar factura' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0);
  });
});
