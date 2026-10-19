import { Injectable } from '@nestjs/common';
import { Agent, request } from 'undici';
import type { LookupFunction } from 'node:net';
import { SsrfGuard, type ResolvedTarget } from './ssrf-guard';
import { redactSecrets } from '../../common/crypto';

export interface SafeHttpResult {
  success: boolean;
  expectedStatus: boolean;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
  errorKind: 'NONE' | 'TIMEOUT' | 'CONNECTION_ERROR' | 'HTTP_STATUS' | 'TOO_MANY_REDIRECTS';
  finalUrl: string;
}

export interface SafeJsonResult {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  body: string;
  error: string | null;
}

@Injectable()
export class SafeHttpService {
  constructor(private readonly ssrf: SsrfGuard) {}

  async check(input: {
    url: string;
    method: 'GET' | 'HEAD';
    expectedStatusCodes: number[];
    timeoutMs: number;
  }): Promise<SafeHttpResult> {
    const startedAt = Date.now();
    const deadline = startedAt + Math.min(Math.max(input.timeoutMs, 1000), 30_000);
    let currentUrl = input.url;
    let finalUrl = currentUrl;

    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return this.timeoutResult(finalUrl, Date.now() - startedAt);
      if (new URL(currentUrl).protocol === 'http:' && new URL(input.url).protocol === 'https:') {
        return {
          success: false,
          expectedStatus: false,
          statusCode: null,
          latencyMs: Date.now() - startedAt,
          error: 'HTTPS-to-HTTP redirects are not allowed',
          errorKind: 'CONNECTION_ERROR',
          finalUrl: currentUrl,
        };
      }

      let resolved: { url: URL; target: ResolvedTarget | null };
      try {
        resolved = await withTimeout(this.ssrf.resolve(currentUrl), Math.min(remaining, 5000));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to resolve host';
        return {
          success: false,
          expectedStatus: false,
          statusCode: null,
          latencyMs: Date.now() - startedAt,
          error: redactSecrets(message, 500),
          errorKind: /timed out/i.test(message) ? 'TIMEOUT' : 'CONNECTION_ERROR',
          finalUrl: currentUrl,
        };
      }

      const dispatcher = this.buildPinnedDispatcher(resolved.target);
      try {
        const requestStarted = Date.now();
        const response = await request(resolved.url, {
          method: input.method,
          dispatcher,
          maxRedirections: 0,
          signal: AbortSignal.timeout(Math.max(200, deadline - Date.now())),
          headers: {
            'user-agent': 'Outpost-Monitor/1.0 (+https://outpost.dev)',
            accept: '*/*',
            'accept-encoding': 'identity',
            'cache-control': 'no-cache',
          },
          headersTimeout: Math.max(200, deadline - Date.now()),
          bodyTimeout: Math.max(200, deadline - Date.now()),
        });
        const latencyMs = Date.now() - requestStarted;
        const statusCode = response.statusCode;
        const location = response.headers.location;
        response.body.destroy();

        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          if (redirects === 5) {
            return {
              success: false,
              expectedStatus: false,
              statusCode,
              latencyMs: Date.now() - startedAt,
              error: 'Too many redirects',
              errorKind: 'TOO_MANY_REDIRECTS',
              finalUrl,
            };
          }
          let next: URL;
          try {
            next = new URL(Array.isArray(location) ? location[0] : location, resolved.url);
          } catch {
            return {
              success: false,
              expectedStatus: false,
              statusCode,
              latencyMs: Date.now() - startedAt,
              error: 'Redirect returned an invalid location',
              errorKind: 'CONNECTION_ERROR',
              finalUrl,
            };
          }
          currentUrl = next.toString();
          finalUrl = currentUrl;
          continue;
        }

        const expectedStatus = input.expectedStatusCodes.includes(statusCode);
        return {
          success: expectedStatus,
          expectedStatus,
          statusCode,
          latencyMs: Math.max(latencyMs, Date.now() - startedAt),
          error: expectedStatus ? null : `Unexpected HTTP status ${statusCode}`,
          errorKind: expectedStatus ? 'NONE' : 'HTTP_STATUS',
          finalUrl,
        };
      } catch (error) {
        const err = error as Error & { code?: string };
        const timeout =
          err.name === 'TimeoutError' ||
          err.name === 'AbortError' ||
          err.code?.includes('TIMEOUT') ||
          /timeout/i.test(err.message);
        return {
          success: false,
          expectedStatus: false,
          statusCode: null,
          latencyMs: Date.now() - startedAt,
          error: timeout
            ? `Request timed out after ${input.timeoutMs}ms`
            : redactSecrets(this.describeConnectionError(err), 500),
          errorKind: timeout ? 'TIMEOUT' : 'CONNECTION_ERROR',
          finalUrl: currentUrl,
        };
      } finally {
        await dispatcher.close().catch(() => undefined);
      }
    }

    return {
      success: false,
      expectedStatus: false,
      statusCode: null,
      latencyMs: Date.now() - startedAt,
      error: 'Too many redirects',
      errorKind: 'TOO_MANY_REDIRECTS',
      finalUrl,
    };
  }

  /**
   * POST JSON to a customer integration URL with the same SSRF protections.
   * Redirects are rejected rather than followed so credentials cannot be
   * forwarded to an unvalidated destination.
   */
  async postJson(input: {
    url: string;
    headers?: Record<string, string>;
    body: unknown;
    timeoutMs?: number;
    maxResponseBytes?: number;
  }): Promise<SafeJsonResult> {
    const startedAt = Date.now();
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 10_000, 1000), 30_000);
    let resolved: { url: URL; target: ResolvedTarget | null };
    try {
      resolved = await withTimeout(this.ssrf.resolve(input.url), Math.min(timeoutMs, 5000));
    } catch (error) {
      return {
        ok: false,
        statusCode: null,
        latencyMs: Date.now() - startedAt,
        body: '',
        error: redactSecrets((error as Error).message, 500),
      };
    }
    const dispatcher = this.buildPinnedDispatcher(resolved.target);
    try {
      const response = await request(resolved.url, {
        method: 'POST',
        dispatcher,
        maxRedirections: 0,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': 'Outpost-Integration/1.0',
          ...input.headers,
        },
        body: JSON.stringify(input.body ?? {}),
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
      const limit = input.maxResponseBytes ?? 64 * 1024;
      let text = '';
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > limit) {
          response.body.destroy();
          return {
            ok: false,
            statusCode: response.statusCode,
            latencyMs: Date.now() - startedAt,
            body: '',
            error: 'Integration response exceeded the size limit',
          };
        }
        text += Buffer.from(chunk).toString('utf8');
      }
      const latencyMs = Date.now() - startedAt;
      if (response.statusCode >= 300 && response.statusCode < 400) {
        return {
          ok: false,
          statusCode: response.statusCode,
          latencyMs,
          body: text.slice(0, 2000),
          error: 'Integration endpoint returned a redirect',
        };
      }
      return {
        ok: response.statusCode >= 200 && response.statusCode < 300,
        statusCode: response.statusCode,
        latencyMs,
        body: text.slice(0, 32_000),
        error: null,
      };
    } catch (error) {
      const err = error as Error;
      const timeout =
        err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout/i.test(err.message);
      return {
        ok: false,
        statusCode: null,
        latencyMs: Date.now() - startedAt,
        body: '',
        error: timeout ? 'Integration request timed out' : redactSecrets(err.message, 500),
      };
    } finally {
      await dispatcher.close().catch(() => undefined);
    }
  }

  private buildPinnedDispatcher(target: ResolvedTarget | null): Agent {
    if (!target) return new Agent();
    // Pin the validated IP so the HTTP client cannot be redirected by a second
    // DNS answer (DNS rebinding). TLS SNI/Host remains the original hostname.
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, target.address, target.family);
    };
    return new Agent({
      connect: {
        lookup: pinnedLookup,
        timeout: 10_000,
      },
      pipelining: 0,
      connections: 1,
    });
  }

  private describeConnectionError(error: Error & { code?: string }): string {
    if (error.code === 'ENOTFOUND') return 'DNS lookup failed';
    if (error.code === 'ECONNREFUSED') return 'Connection refused';
    if (error.code === 'ECONNRESET') return 'Connection reset by peer';
    if (error.code === 'CERT_HAS_EXPIRED') return 'TLS certificate has expired';
    if (error.code?.startsWith('UND_ERR')) return 'HTTP connection failed';
    return error.message || 'Connection failed';
  }

  private timeoutResult(finalUrl: string, latencyMs: number): SafeHttpResult {
    return {
      success: false,
      expectedStatus: false,
      statusCode: null,
      latencyMs,
      error: 'Monitoring request exceeded its deadline',
      errorKind: 'TIMEOUT',
      finalUrl,
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out')), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
