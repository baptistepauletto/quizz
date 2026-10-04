const TOKEN_KEY = 'quizzin.token';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly problems: string[] = [],
  ) {
    super(message);
  }
}

export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.problems ?? []);
  }
  return data as T;
}

export async function login(pin: string): Promise<void> {
  const res = await api<{ token: string }>('POST', '/api/auth', { pin });
  setToken(res.token);
}

export interface LanInfo {
  ips: string[];
  port: number;
}

export const fetchInfo = () => api<LanInfo>('GET', '/api/info');

/** The address phones should use to reach this server (the TV PC is usually opened as "localhost"). */
export function lanOrigin(info: LanInfo | null, ipIndex = 0): string {
  const override = new URLSearchParams(location.search).get('ip');
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!isLocal && !override) return location.origin;
  const ips = info?.ips ?? [];
  const ip = override ?? (ips.length ? ips[ipIndex % ips.length] : location.hostname);
  const port = location.port || String(info?.port ?? 3000);
  return `${location.protocol}//${ip}${port === '80' ? '' : `:${port}`}`;
}
