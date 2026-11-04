import { expect, test } from '@playwright/test';
import { login, USERS } from './support/helpers';

test.describe('ADM-01 login', () => {
  test('wrong password shows an error and keeps the user out', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Correo').fill(USERS.am);
    await page.getByLabel('Contraseña').fill('wrong-password-123');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByRole('button', { name: 'theme' })).toHaveCount(0);
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(401);
  });

  test('valid login opens the Resumen; session cookie is httpOnly; logout ends the session', async ({
    page,
  }) => {
    await login(page, 'am');
    await expect(page.getByRole('heading', { name: 'Resumen', level: 2 })).toBeVisible();
    const cookies = await page.context().cookies();
    const sid = cookies.find((c) => c.name === 'wc_sid');
    expect(sid?.httpOnly).toBe(true);
    expect(sid?.sameSite).toBe('Lax');
    expect(cookies.find((c) => c.name === 'wc_csrf')?.httpOnly).toBe(false);
    const me = await (await page.request.get('/api/v1/auth/me')).json();
    expect(me.data).toMatchObject({ email: USERS.am, roles: ['ACCOUNT_MANAGER'] });

    await page.getByRole('button', { name: 'user' }).click();
    await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  });

  test('every API call requires a session and mutations require the CSRF token', async ({
    page,
  }) => {
    for (const url of ['/api/v1/opportunities', '/api/v1/dashboard/kpis', '/api/v1/audit-log']) {
      expect((await page.request.get(url)).status()).toBe(401);
    }
    await login(page, 'am');
    const noCsrf = await page.request.post('/api/v1/notifications/read-all', { data: {} });
    expect(noCsrf.status()).toBe(403);
    expect((await noCsrf.json()).code).toBe('CSRF_INVALID');
  });
});
