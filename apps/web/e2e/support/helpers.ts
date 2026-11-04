import { expect, type APIResponse, type Page } from '@playwright/test';

/** Demo users created by `db:seed -- --demo` (README "Usuarios demo"). */
export const USERS = {
  cm: 'jesus.depablo@example.com',
  am: 'manuel.ibieta@example.com',
  lin: 'lin.han@example.com',
  cnDelivery: 'delivery.china@example.com',
  clDelivery: 'delivery.chile@example.com',
  finance: 'finanzas.china@example.com',
  legal: 'legal.china@example.com',
  vp: 'jacky@example.com',
  president: 'alex.xiao@example.com',
  admin: 'admin@example.com',
  kong: 'alex.kong@example.com',
} as const;
export type Who = keyof typeof USERS;

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo-Password-2026!';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-admin-123';

/** "Today" as the API computes it (APP_TIMEZONE = America/Santiago). */
export function todayCl(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(d);
}

/** Calendar arithmetic on YYYY-MM-DD. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let seq = 0;
export function uniq(prefix: string): string {
  seq++;
  return `${prefix} ${Date.now().toString(36).toUpperCase()}${seq}`;
}

/**
 * Logs in through the real login form and waits for the app shell. The app applies the user's
 * saved language at login (QA-003); unless `keepLocale` is set, the UI is switched back to es-CL
 * so the Spanish selectors used by the specs work for the zh-CN demo users too.
 */
export async function login(
  page: Page,
  who: Who,
  opts: { keepLocale?: boolean } = {},
): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/');
  if ((await page.locator('html').getAttribute('lang')) !== 'es-CL') {
    await page.evaluate(() => localStorage.removeItem('wcrm.locale'));
    await page.reload();
  }
  await page.getByLabel('Correo').fill(USERS[who]);
  await page.getByLabel('Contraseña').fill(who === 'admin' ? ADMIN_PASSWORD : DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'theme' })).toBeVisible();
  if (opts.keepLocale) return;
  const lang = await page.locator('html').getAttribute('lang');
  if (lang !== 'es-CL') {
    await page.getByRole('textbox', { name: /Idioma|语言|Language/ }).click();
    await page.getByRole('option', { name: 'Español (Chile)' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-CL');
  }
}

export interface Api {
  get(url: string): Promise<APIResponse>;
  post(url: string, body?: unknown): Promise<APIResponse>;
  put(url: string, body?: unknown): Promise<APIResponse>;
  patch(url: string, body?: unknown): Promise<APIResponse>;
}

/**
 * JSON client bound to the browser session of `page` (same cookies, CSRF double submit).
 * Used to prepare data quickly; the behaviour under test is asserted through the UI.
 */
export async function apiOf(page: Page): Promise<Api> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === 'wc_csrf')?.value ?? '';
  const headers = { 'x-csrf-token': csrf };
  const r = page.request;
  return {
    get: (url) => r.get(`/api/v1${url}`),
    post: (url, body) => r.post(`/api/v1${url}`, { data: body ?? {}, headers }),
    put: (url, body) => r.put(`/api/v1${url}`, { data: body ?? {}, headers }),
    patch: (url, body) => r.patch(`/api/v1${url}`, { data: body ?? {}, headers }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON payloads of any endpoint
export async function data(res: APIResponse | Promise<APIResponse>): Promise<any> {
  const r = await res;
  const text = await r.text();
  if (r.status() >= 300) throw new Error(`HTTP ${r.status()} ${r.url()}: ${text.slice(0, 600)}`);
  return JSON.parse(text).data;
}

export async function errorCodes(res: APIResponse | Promise<APIResponse>): Promise<string[]> {
  const body = await (await res).json();
  return (body.errors ?? []).map((e: { code: string }) => e.code);
}

/** Picks an option of a Mantine Select by its visible label. */
export async function pick(page: Page, label: string | RegExp, option: string | RegExp) {
  await page.getByRole('textbox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option }).first().click();
}

export async function openOpportunity(page: Page, id: string, tab?: string) {
  await page.goto(`/oportunidades/${id}`);
  await expect(page.getByTestId('opp-title')).toBeVisible();
  if (tab) await page.getByRole('tab', { name: tab, exact: true }).click();
}

export async function findOpportunity(page: Page, name: string): Promise<{ id: string }> {
  const api = await apiOf(page);
  const list: { id: string; name: string }[] = await data(
    api.get(`/opportunities?q=${encodeURIComponent(name)}`),
  );
  const o = list.find((x) => x.name === name);
  if (!o) throw new Error(`opportunity not found: ${name}`);
  return o;
}

/** Payment milestones as the API expects them ([30, 50, 20] → 3 milestones). */
export function milestonesPct(pcts: number[]) {
  const triggers = ['SIGNATURE', 'SRS_DONE', 'UAT', 'GO_LIVE'];
  return pcts.map((pct, i) => ({
    seq: i + 1,
    pct: String(pct),
    trigger: triggers[i] ?? 'OTHER',
    triggerText: `${pct}% ${triggers[i] ?? 'OTHER'}`,
  }));
}

/** Sheet line with a given net-income margin (no commercial costs). */
export function lineAt(lineNo: number, itemType: string, price: number, margin: number) {
  return {
    lineNo,
    itemType,
    capexOpex: itemType.startsWith('SUPPORT') ? 'OPEX' : 'CAPEX',
    cost: (Math.round(price * (1 - margin) * 100) / 100).toFixed(2),
    priceExTax: price.toFixed(2),
    netIncome: price.toFixed(2),
    commercialCosts: '0',
  };
}

/** BANT complete + MEDDPICC with `meddpicc` of the 8 elements complete (P2-01/02). */
export function qualification(meddpicc = 0) {
  const keys = [
    'mMetrics',
    'mEconomicBuyer',
    'mDecisionCriteria',
    'mDecisionProcess',
    'mPaperProcess',
    'mIdentifyPain',
    'mChampion',
    'mCompetition',
  ];
  return {
    bantBudget: 'COMPLETE',
    bantAuthority: 'COMPLETE',
    bantNeed: 'COMPLETE',
    bantTimeline: 'COMPLETE',
    ...Object.fromEntries(keys.map((k, i) => [k, i < meddpicc ? 'COMPLETE' : 'EMPTY'])),
    notes: {},
  };
}

export const A1_COMPLETE = (targetPrice: string) => ({
  competitionType: 'TENDER_3_PLUS',
  solutionOwnerName: 'Lin Han',
  deliveryOwnerName: 'I+D y Delivery China',
  projectStageLabel: 'Solución cerrada',
  projectLevel: 'A',
  budget: targetPrice,
  budgetCurrency: 'USD',
  signingModel: 'SINGLE_CL_SPA',
  currency: 'USD',
  warrantyMonths: 12,
  summary: 'Implementación llave en mano con soporte L2/L3',
  strategy: 'Precio competitivo en CAPEX',
  mainCompetitor: 'Huawei',
  risks: 'Plazo de UAT ajustado',
  scopeSummary: 'BRD v2 del cliente; alcance fase 1',
  assumptions: 'Ambientes provistos por el cliente',
  exclusions: 'Hardware de terceros',
  targetPrice,
  targetPriceCurrency: 'USD',
  targetCompetitor: 'Huawei',
});

/** Connection string of the e2e database (read-only checks of seeded data from the specs). */
export function e2eDbUrl(): string {
  const root = new URL('../../../../', import.meta.url);
  const envFile = new URL('.env', root);
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* no .env: rely on the environment */
  }
  const u = new URL(
    process.env.DATABASE_URL ?? 'postgres://wcrm_app:change-me-app@localhost:5432/wcrm',
  );
  u.pathname = `/${process.env.E2E_DB_NAME ?? 'wcrm_e2e'}`;
  return u.href;
}
