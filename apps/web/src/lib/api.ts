const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const API_PREFIX = '/v1';
const TEAM_STORAGE_KEY = 'outpost.activeTeamId';
const NO_REFRESH_PATHS = new Set([
  '/auth/login',
  '/auth/signup',
  '/auth/refresh',
  '/auth/logout',
  '/auth/recover',
  '/auth/resend-verification',
  '/auth/callback',
]);

export const apiDocsUrl = `${API_BASE || 'http://localhost:4000'}/docs`;

export function apiUrl(path: string): string {
  return `${API_BASE}${API_PREFIX}${path}`;
}

let activeTeamId: string | null = null;

try {
  activeTeamId = localStorage.getItem(TEAM_STORAGE_KEY);
} catch {
  activeTeamId = null;
}

export function setApiTeamId(teamId: string | null): void {
  activeTeamId = teamId;
  try {
    if (teamId) localStorage.setItem(TEAM_STORAGE_KEY, teamId);
    else localStorage.removeItem(TEAM_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in private browsing; the in-memory value is enough.
  }
}

export function getApiTeamId(): string | null {
  return activeTeamId;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function queryString(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const result = search.toString();
  return result ? `?${result}` : '';
}

let refreshRequest: Promise<boolean> | null = null;

export async function refreshSession(): Promise<boolean> {
  if (!refreshRequest) {
    refreshRequest = fetch(`${API_BASE}${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshRequest = null;
      });
  }
  return refreshRequest;
}

function baseHeaders(): Headers {
  const headers = new Headers();
  if (activeTeamId) headers.set('X-Team-Id', activeTeamId);
  return headers;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  skipAuthRefresh?: boolean;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = baseHeaders();
  headers.set('Accept', 'application/json');
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    headers.set(key, value);
  }

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  const url = `${API_BASE}${API_PREFIX}${path}`;
  const canRefresh = !options.skipAuthRefresh && !NO_REFRESH_PATHS.has(path);

  const send = (): Promise<Response> =>
    fetch(url, {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: 'include',
    });

  let response = await send();
  if (response.status === 401 && canRefresh && (await refreshSession())) {
    response = await send();
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';
    let message = `Request failed (${response.status})`;
    let details: unknown;
    if (contentType.includes('application/json')) {
      try {
        const payload = (await response.json()) as {
          message?: string | string[];
          error?: string;
          statusCode?: number;
        };
        details = payload;
        if (Array.isArray(payload.message)) message = payload.message.join(' · ');
        else if (payload.message) message = payload.message;
        else if (payload.error) message = payload.error;
      } catch {
        // Keep the generic message.
      }
    } else {
      const text = await response.text().catch(() => '');
      if (text && text.length < 500) message = text;
    }
    if (response.status === 401) {
      message =
        message === 'Unauthorized' || message === 'Authentication required'
          ? 'Your session has expired. Please sign in again.'
          : message;
    }
    throw new ApiError(message, response.status, details);
  }

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return (await response.text()) as T;
  }
  return (await response.json()) as T;
}

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const headers = baseHeaders();
  const url = `${API_BASE}${API_PREFIX}${path}`;
  const send = (): Promise<Response> =>
    fetch(url, { headers, credentials: 'include' });
  let response = await send();
  if (response.status === 401 && (await refreshSession())) {
    response = await send();
  }
  if (!response.ok) {
    let message = `Download failed (${response.status})`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) message = payload.message;
    } catch {
      // Keep the generic message.
    }
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const filenameMatch = /filename="?([^"]+)"?/.exec(disposition);
  const filename = filenameMatch?.[1] || fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
