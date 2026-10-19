import type { Environment } from '@prisma/client';
import {
  deriveSeverity,
  fingerprintError,
  normalizeEnvironment,
  sanitizeMetadata,
  sanitizeStackTrace,
} from './error-sanitizer';

const environment: Environment = 'PRODUCTION';

describe('error sanitization and grouping', () => {
  it('groups volatile values into a stable fingerprint', () => {
    const first = fingerprintError({
      environment,
      serviceName: 'api',
      errorType: 'TypeError',
      message:
        'User 123e4567-e89b-12d3-a456-426614174000 failed with code 500 for user@example.com from 10.0.0.4',
    });
    const second = fingerprintError({
      environment,
      serviceName: 'api',
      errorType: 'TypeError',
      message:
        'User 987e6543-e21b-12d3-a456-426614174999 failed with code 503 for other@example.org from 192.168.1.9',
    });

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it('keeps fingerprints isolated by service, error type, and environment', () => {
    const base = {
      environment,
      serviceName: 'api',
      errorType: 'TypeError',
      message: 'Cannot read properties of undefined',
    };
    const fingerprint = fingerprintError(base);

    expect(fingerprintError({ ...base, serviceName: 'worker' })).not.toBe(fingerprint);
    expect(fingerprintError({ ...base, errorType: 'RangeError' })).not.toBe(fingerprint);
    expect(fingerprintError({ ...base, environment: 'STAGING' })).not.toBe(fingerprint);
  });

  it('normalizes message shapes, identifiers, emails, and numbers', () => {
    const fingerprint = fingerprintError({
      environment,
      serviceName: 'API',
      errorType: 'Error',
      message:
        'Request 0xdeadbeef retried id=0123456789abcdef for person@example.com at 10.1.2.3 after 3.14 seconds: "quoted value"',
    });

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('strips secrets from stack traces and query strings', () => {
    const stack = sanitizeStackTrace(
      'Error: failed\n    at handler (/app/server.js:10:2)\nAuthorization: Bearer abc123\nhttps://api.example.com/callback?token=secret-value',
    );

    expect(stack).toContain('handler');
    expect(stack).not.toContain('abc123');
    expect(stack).not.toContain('secret-value');
    expect(stack).toContain('[REDACTED]');
  });

  it('removes nested secret keys before persisting metadata', () => {
    const metadata = sanitizeMetadata({
      password: 'hunter2',
      authorization: 'Bearer abc123',
      nested: { clientSecret: 'shh', requestId: 'req-1' },
      list: ['token=abc', { apiKey: 'key-value' }],
      message: 'failed with token=abc123',
    });

    expect(metadata).toMatchObject({
      password: '[REDACTED]',
      authorization: '[REDACTED]',
      nested: { clientSecret: '[REDACTED]', requestId: 'req-1' },
      list: ['token=[REDACTED]', { apiKey: '[REDACTED]' }],
    });
    expect(JSON.stringify(metadata)).not.toContain('hunter2');
    expect(JSON.stringify(metadata)).not.toContain('abc123');
  });

  it('truncates deeply nested metadata', () => {
    const metadata = sanitizeMetadata({
      one: { two: { three: { four: { five: 'value' } } } },
    });
    expect(JSON.stringify(metadata)).toContain('truncated');
  });

  it('normalizes environment aliases and rejects unknown values', () => {
    expect(normalizeEnvironment(undefined)).toBe('PRODUCTION');
    expect(normalizeEnvironment('prod')).toBe('PRODUCTION');
    expect(normalizeEnvironment('stage')).toBe('STAGING');
    expect(normalizeEnvironment('dev')).toBe('DEVELOPMENT');
    expect(normalizeEnvironment('testing')).toBe('TEST');
    expect(() => normalizeEnvironment('moon')).toThrow('Invalid environment');
  });

  it('derives severity from HTTP status without inventing fatal errors', () => {
    expect(deriveSeverity(503)).toBe('ERROR');
    expect(deriveSeverity(404)).toBe('WARNING');
    expect(deriveSeverity(undefined)).toBe('ERROR');
  });
});
