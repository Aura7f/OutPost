import { supabase } from './supabase';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const API_PREFIX = '/v1';
const TEAM_STORAGE_KEY = 'outpost.activeTeamId';

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

async function authHeaders(): Promise<Headers> {
  const headers = new Headers();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  if (activeTeamId) headers.set('X-Team-Id', activeTeamId);
  return headers;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = await authHeaders();
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

  const response = await fetch(`${API_BASE}${API_PREFIX}${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    body,
    signal: options.signal,
  });

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
      // Let the auth listener decide; avoid signing out during a transient outage.
      message = message === 'Unauthorized' ? 'Your session has expired. Please sign in again.' : message;
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
  const headers = await authHeaders();
  const response = await fetch(`${API_BASE}${API_PREFIX}${path}`, { headers });
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
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
