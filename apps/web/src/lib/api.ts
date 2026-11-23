/**
 * The web app can be served from Vercel while the API/WS run on a separate
 * Node host. With no VITE_API_URL / VITE_WS_URL the relative local dev paths
 * are kept, so the Vite proxy and existing tests are unchanged.
 */
const apiOrigin = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
export const apiUrl = (path: string): string => `${apiOrigin}/api${path}`;

function wsOrigin(): string {
  const configured = (import.meta.env.VITE_WS_URL ?? '').trim().replace(/\/+$/, '');
  if (!configured) return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
  if (/^wss?:\/\//i.test(configured)) return configured;
  return configured.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
}

export interface ApiErrorShape { code: string; message: string; details?: unknown }

export class ApiError extends Error {
  constructor(public status: number, public info: ApiErrorShape) {
    super(info.message);
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)saha_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['x-csrf-token'] = csrfToken();
  const response = await fetch(apiUrl(path), {
    method,
    headers,
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  if (!response.ok) {
    let info: ApiErrorShape = { code: 'REQUEST_FAILED', message: `Request failed (${response.status})` };
    try {
      const payload = await response.json() as { error?: ApiErrorShape };
      if (payload.error) info = payload.error;
    } catch { /* keep fallback */ }
    throw new ApiError(response.status, info);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const downloadCsv = async (path: string, filename: string): Promise<void> => {
  const response = await fetch(apiUrl(path), { credentials: 'include' });
  if (!response.ok) throw new ApiError(response.status, { code: 'EXPORT_FAILED', message: 'Could not export the report' });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const wsUrl = (token: string, orgId: string, workspaceId: string): string => {
  return `${wsOrigin()}/ws/world?token=${encodeURIComponent(token)}&orgId=${encodeURIComponent(orgId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
};

export const getCookie = (name: string): string => {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
};
