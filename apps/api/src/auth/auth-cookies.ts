import type { CookieOptions, Request, Response } from 'express';

export const ACCESS_COOKIE = 'outpost_access';
export const REFRESH_COOKIE = 'outpost_refresh';
export const REFRESH_COOKIE_PATH = '/v1/auth';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CookieSameSite = 'lax' | 'strict' | 'none';

export interface AuthCookieOptions {
  secure: boolean;
  sameSite: CookieSameSite;
}

export interface SessionCookiePayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function baseOptions(options: AuthCookieOptions): CookieOptions {
  return {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
  };
}

export function setSessionCookies(
  response: Response,
  session: SessionCookiePayload,
  options: AuthCookieOptions,
): void {
  response.cookie(ACCESS_COOKIE, session.accessToken, {
    ...baseOptions(options),
    path: '/',
    maxAge: Math.max(60, session.expiresIn) * 1000,
  });
  response.cookie(REFRESH_COOKIE, session.refreshToken, {
    ...baseOptions(options),
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearSessionCookies(response: Response, options: AuthCookieOptions): void {
  response.clearCookie(ACCESS_COOKIE, { ...baseOptions(options), path: '/' });
  response.clearCookie(REFRESH_COOKIE, {
    ...baseOptions(options),
    path: REFRESH_COOKIE_PATH,
  });
}

export function readAccessCookie(request: Request): string | undefined {
  return request.cookies?.[ACCESS_COOKIE];
}

export function readRefreshCookie(request: Request): string | undefined {
  return request.cookies?.[REFRESH_COOKIE];
}
