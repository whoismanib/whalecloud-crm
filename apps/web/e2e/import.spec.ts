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
