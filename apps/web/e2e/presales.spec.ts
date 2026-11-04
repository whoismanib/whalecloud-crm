import { expect, test } from '@playwright/test';
import { login } from './support/helpers';

/** P3 Preventa (QA-004): KPIs, matrix and the CM review gate before "entregada" (P3-04). */
test('RFI/RFP list with KPIs; delivery blocked until the matrix is complete and the CM reviews it', async ({
  page,
}) => {
  await login(page, 'am');
  await page.getByRole('link', { name: 'Preventa RFI/RFP' }).click();
  await expect(page.getByTestId('rfp-kpis')).toContainText('Tasa de adjudicación');
  await expect(page.getByTestId('rfp-kpis')).toContainText('0,0'); // GTD delivered on time and lost
  await page.getByTestId('rfps-table').getByText('RFI · RFI Digital OSS / iNOC').click();
  const detail = page.getByTestId('rfp-detail');
  await expect(detail).toContainText('Hito interno (−5 d háb.)');
  await expect(page.getByTestId('rfp-matrix').locator('tbody tr')).toHaveCount(3);
  await page.getByTestId('rfp-deliver').click();
  await expect(page.getByTestId('rule-errors')).toContainText('requisitos sin responder');
  await expect(page.getByTestId('rule-errors')).toContainText('revisión del Country Manager');
});
