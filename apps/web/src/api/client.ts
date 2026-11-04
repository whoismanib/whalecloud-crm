/** Fetch wrapper: same-origin cookies, CSRF header, RFC 9457 problem+json errors. */
export interface ProblemError {
  code: string;
  params?: Record<string, unknown>;
  path?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public errors: ProblemError[] = [],
  ) {
    super(code);
  }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)wc_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : '';
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  const res = await fetch(`/api/v1${url}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, json.code ?? 'INTERNAL', json.errors ?? []);
  return (json.data ?? json) as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
};
