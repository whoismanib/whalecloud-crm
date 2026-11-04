import { expect, test } from '@playwright/test';
import { apiOf, login } from './support/helpers';

/** ADM-05 languages (es-CL default, zh-CN, en) and the light/dark theme. */
test.describe('language and theme', () => {
  test.afterEach(async ({ page }) => {
    // the switch persists the preference: restore it for the next runs
    await (await apiOf(page)).patch('/me/preferences', { locale: 'es-CL' }).catch(() => undefined);
  });

  test('switching to zh-CN translates navigation, KPIs and enums', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByRole('link', { name: 'Oportunidades' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Idioma' }).click();
    await page.getByRole('option', { name: '简体中文' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('link', { name: '概览' })).toBeVisible();
    await expect(page.getByTestId('kpi-SS_SIGNED')).toContainText('S&S 签约额');
    await expect(page.getByRole('link', { name: 'Oportunidades' })).toHaveCount(0);
    // persisted in the user's preferences
    const me = await (await page.request.get('/api/v1/auth/me')).json();
    expect(me.data.locale).toBe('zh-CN');
    // and kept after a reload
    await page.reload();
    await expect(page.getByRole('link', { name: '概览' })).toBeVisible();

    await page.getByRole('textbox', { name: '语言' }).click();
    await page.getByRole('option', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('textbox', { name: /Language/ }).click();
    await page.getByRole('option', { name: 'Español (Chile)' }).click();
    await expect(page.getByRole('link', { name: 'Oportunidades' })).toBeVisible();
  });

  test("applies the user's saved language at login (QA-003)", async ({ page }) => {
    // Alex Kong's profile language is zh-CN; the browser has no local choice (es-CL login page)
    await login(page, 'kong', { keepLocale: true });
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('link', { name: '概览' })).toBeVisible();
    // logging out and in as a Spanish-speaking user switches back to that user's language
    await login(page, 'am', { keepLocale: true });
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-CL');
    await expect(page.getByRole('link', { name: 'Oportunidades' })).toBeVisible();
  });

  test('dark mode toggles the color scheme and survives a reload', async ({ page }) => {
    await login(page, 'admin');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-mantine-color-scheme', 'light');
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.getByTestId('theme-toggle').click();
    await expect(html).toHaveAttribute('data-mantine-color-scheme', 'dark');
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBg).not.toBe(lightBg);
    await page.reload();
    await expect(html).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await page.getByTestId('theme-toggle').click();
    await expect(html).toHaveAttribute('data-mantine-color-scheme', 'light');
  });
});
