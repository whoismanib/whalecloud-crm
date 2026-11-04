import { expect, test, type Page } from '@playwright/test';
import { login } from './support/helpers';

/** QA-005 (PRD §5 responsive): at 390 px the page never scrolls sideways and the header fits. */
test.use({ viewport: { width: 390, height: 844 } });

async function assertFits(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const r = await page.evaluate(() => {
    const d = document.documentElement;
    const header = document.querySelector('header')!;
    const hb = header.getBoundingClientRect().bottom;
    const spill = Array.from(header.querySelectorAll('*')).some((el) => {
      const b = el.getBoundingClientRect();
      return b.height > 0 && b.bottom > hb + 1;
    });
    const h2 = document.querySelector('main h2');
    return {
      overflowX: d.scrollWidth - d.clientWidth,
      spill,
      titleBelowHeader: !h2 || h2.getBoundingClientRect().top >= hb,
    };
  });
  expect(r, label).toEqual({ overflowX: 0, spill: false, titleBelowHeader: true });
}

test('pages fit a 390 px screen; wide tables scroll inside their container', async ({ page }) => {
  await login(page, 'cm');
  for (const path of [
    '/',
    '/cuentas',
    '/oportunidades',
    '/facturacion',
    '/salud',
    '/incidentes',
    '/bitacora',
    '/traspasos',
    '/renovaciones',
    '/pronostico',
    '/incorporacion',
  ]) {
    await page.goto(path);
    await assertFits(page, path);
  }
  await page.goto('/facturacion');
  const box = page.getByTestId('invoices-table').locator('xpath=..');
  const scroll = await box.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scroll).toBe(true);
  await page.goto('/oportunidades');
  await page.getByText('Equifiber — OSS fase 1').first().click();
  await page.getByTestId('opp-title').waitFor();
  for (const tab of ['Solicitud de precio (A1)', 'Líneas y margen', 'Hitos', 'Bitácora']) {
    await page.getByRole('tab', { name: tab }).click();
    await assertFits(page, tab);
  }
});
