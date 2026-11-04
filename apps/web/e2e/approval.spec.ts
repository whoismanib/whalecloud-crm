import { expect, test, type Page } from '@playwright/test';
import {
  addDays,
  apiOf,
  data,
  errorCodes,
  lineAt,
  login,
  openOpportunity,
  todayCl,
} from './support/helpers';
import {
  approvedBusinessCase,
  loadSheet,
  newOpportunity,
  qualifyTo,
  submitPriceRequest,
} from './support/flows';

/**
 * P6-02 routing by the most restrictive line (net-income margin) and RBAC on decisions (ADM-02):
 * 50–60 % → Jacky (VP), 60 %–target → Alex Xiao (LatAm president), ≥ target → China committee.
 */
const inboxCard = (page: Page, name: string) =>
  page.getByTestId('approvals-inbox').locator('.mantine-Paper-root', { hasText: name });

async function openInbox(page: Page) {
  await page.getByRole('link', { name: 'Aprobaciones' }).click();
  await expect(page.getByRole('heading', { name: 'Mi bandeja de aprobaciones' })).toBeVisible();
}

test.describe('P6 approval routing', () => {
  test('a line at 55 % routes to Jacky (VP) and requires an approved business case', async ({
    page,
  }) => {
    await login(page, 'am');
    const s = await newOpportunity(page, { amount: '800000' });
    await qualifyTo(page, s, 3);
    const prId = await submitPriceRequest(page, s, '800000');
    const sheet = await loadSheet(page, prId, [
      lineAt(1, 'OWN_SOFTWARE', 500000, 0.7),
      lineAt(2, 'IMPLEMENTATION', 300000, 0.55),
    ]);
    expect(sheet.proposedBand).toBe('VP');

    await login(page, 'am');
    await openOpportunity(page, s.oppId, 'Aprobación');
    const preview = page.getByTestId('approval-preview');
    await expect(preview).toContainText('Jacky (VP)');
    await expect(preview).toContainText('Caso de negocio aprobado obligatorio');
    await page.getByTestId('request-approval').click();
    await expect(page.getByTestId('rule-errors')).toContainText('Caso de negocio');

    await approvedBusinessCase(page, s.oppId);
    await login(page, 'am');
    await openOpportunity(page, s.oppId, 'Aprobación');
    await page.getByTestId('request-approval').click();
    await expect(page.getByText('Margen · VP').last()).toBeVisible();

    // the AM (R in P6) cannot approve, the president cannot take Jacky's step
    const am = await apiOf(page);
    const [req] = await data(am.get(`/opportunities/${s.oppId}/approval-requests`));
    const stepId = req.steps[0].id;
    expect(
      (await am.post(`/approval-steps/${stepId}/decision`, { decision: 'APPROVED' })).status(),
    ).toBe(403);
    await login(page, 'president');
    await openInbox(page);
    await expect(inboxCard(page, s.name)).toHaveCount(0);
    expect(
      (
        await (
          await apiOf(page)
        ).post(`/approval-steps/${stepId}/decision`, { decision: 'APPROVED' })
      ).status(),
    ).toBe(403);

    await login(page, 'vp');
    await openInbox(page);
    const card = inboxCard(page, s.name);
    await expect(card).toContainText('Margen · VP');
    // P6-04: rejecting needs a comment
    await card.getByRole('button', { name: 'Rechazar' }).click();
    await expect(card.getByTestId('rule-errors')).toBeVisible();
    await card.getByTestId('approve-btn').click();
    await expect(card).toHaveCount(0);

    await login(page, 'am');
    await openOpportunity(page, s.oppId);
    // P6-05/06: approved margin and 60-day validity recorded on the opportunity
    const o = await data((await apiOf(page)).get(`/opportunities/${s.oppId}`));
    expect(o.approvedNetMargin).toBe('0.643750'); // (500k·0,70 + 300k·0,55) / 800k
    expect(o.approvalExpiresOn).toBe(addDays(todayCl(), 60));
    await expect(page.getByText('64,4 %').or(page.getByText('64,4%')).first()).toBeVisible();
  });

  test('L2 at 63,84 % (WOM case) routes to Alex Xiao and needs a competitive justification', async ({
    page,
  }) => {
    await login(page, 'am');
    const s = await newOpportunity(page, { amount: '900000' });
    await qualifyTo(page, s, 3);
    const prId = await submitPriceRequest(page, s, '900000');
    const sheet = await loadSheet(page, prId, [
      lineAt(1, 'OWN_SOFTWARE', 500000, 0.7),
      lineAt(2, 'SUPPORT_L3', 250000, 0.8),
      lineAt(3, 'SUPPORT_L1L2', 150000, 0.6384),
    ]);
    expect(sheet.proposedBand).toBe('PRESIDENT');

    await login(page, 'am');
    const am = await apiOf(page);
    expect(await errorCodes(am.post(`/sheet-versions/${sheet.id}/approval-requests`, {}))).toEqual([
      'JUSTIFICATION_REQUIRED',
    ]);
    await openOpportunity(page, s.oppId, 'Aprobación');
    await expect(page.getByTestId('approval-preview')).toContainText(
      'Alex Xiao (presidente LatAm)',
    );
    await page.getByLabel('Justificación competitiva').fill('Huawei ofertó 15 % bajo');
    await page.getByTestId('request-approval').click();
    await expect(page.getByText('Margen · presidente').last()).toBeVisible();

    await login(page, 'vp');
    await openInbox(page);
    await expect(inboxCard(page, s.name)).toHaveCount(0);

    await login(page, 'president');
    await openInbox(page);
    const card = inboxCard(page, s.name);
    await expect(card).toContainText('Margen · presidente');
    await expect(card).toContainText('Huawei ofertó 15 % bajo');
    await card.getByTestId('approve-btn').click();
    await expect(card).toHaveCount(0);
  });

  test('P6-03: payment term > 60 days adds a non-economic approval step', async ({ page }) => {
    await login(page, 'am');
    const s = await newOpportunity(page, { amount: '400000' });
    await qualifyTo(page, s, 3);
    const prId = await submitPriceRequest(page, s, '400000');
    await loadSheet(
      page,
      prId,
      [lineAt(1, 'OWN_SOFTWARE', 240000, 0.7), lineAt(2, 'IMPLEMENTATION', 160000, 0.65)],
      { paymentTermDays: 90 },
    );
    await login(page, 'am');
    await openOpportunity(page, s.oppId, 'Aprobación');
    const preview = page.getByTestId('approval-preview');
    await expect(preview).toContainText('Comité de precios China');
    await expect(preview).toContainText('Condición no económica');
  });
});
