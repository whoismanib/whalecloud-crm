import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { apiOf, data, login } from './support/helpers';

/** CORE-08 / DASH-07: legacy tracker_data.json import, dry run first (no changes). */
const fixture = fileURLToPath(new URL('./fixtures/tracker_data.json', import.meta.url));

test('legacy tracker_data.json dry run reports rows and creates nothing', async ({ page }) => {
  await login(page, 'admin');
  await page.getByRole('link', { name: 'Administración' }).click();
  await page.getByRole('tab', { name: 'Importación' }).click();
  await expect(page.getByRole('textbox', { name: 'Tipo', exact: true })).toHaveValue(
    'Tracker legado (tracker_data.json)',
  );
  await expect(page.getByRole('switch', { name: 'Simulación' })).toBeChecked();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-file').click();
  await (await chooser).setFiles(fixture);
  await page.getByTestId('import-run').click();

  const result = page.getByTestId('import-result');
  await expect(result).toContainText('Simulación (sin cambios)');
  await expect(result).toContainText('Oportunidades: 4');
  // the billing row without a matching opportunity is reported per row
  await expect(result.locator('p', { hasText: '#' })).toHaveCount(1);

  const api = await apiOf(page);
  const opps: unknown[] = await data(api.get('/opportunities?q=E2E%20Legacy'));
  expect(opps).toHaveLength(0);
  const accounts: { name: string }[] = await data(api.get('/accounts?q=E2E%20Legacy'));
  expect(accounts).toHaveLength(0);
});

/** P10-02: legacy edo_incidents.json (fictitious fixture), dry run then real, idempotent. */
const edoFixture = fileURLToPath(
  new URL(
    '../../../packages/shared/src/rules/__fixtures__/edo_incidents.sample.json',
    import.meta.url,
  ),
);

test('eDo incidents import: dry run, real run and re-run without changes', async ({ page }) => {
  await login(page, 'admin');
  await page.getByRole('link', { name: 'Administración' }).click();
  await page.getByRole('tab', { name: 'Importación' }).click();
  await page.getByTestId('import-kind').click();
  await page.getByRole('option', { name: 'Incidentes eDo (edo_incidents.json)' }).click();
  await expect(page.getByRole('textbox', { name: 'Cuenta' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-file').click();
  await (await chooser).setFiles(edoFixture);
  const result = page.getByTestId('import-result');
  const api = await apiOf(page);
  const edo = async () =>
    ((await data(api.get('/tickets'))) as { externalId: string | null; isOpen: boolean }[]).filter(
      (t) => t.externalId?.startsWith('IS2637'),
    );

  await page.getByTestId('import-run').click();
  await expect(result).toContainText('Simulación (sin cambios)');
  await expect(result).toContainText('Tickets: 62');
  expect(await edo()).toHaveLength(0);

  await page
    .getByRole('switch', { name: 'Simulación' })
    .evaluate((el) => (el as HTMLInputElement).click());
  await page.getByTestId('import-run').click();
  await expect(result).toContainText('Importación aplicada');
  await expect(result).toContainText('Tickets: 62');
  const tickets = await edo();
  expect(tickets).toHaveLength(62);
  expect(tickets.filter((t) => t.isOpen)).toHaveLength(26);

  await page.getByTestId('import-run').click();
  await expect(result).toContainText('62 omitidas');
  expect(await edo()).toHaveLength(62);
});
