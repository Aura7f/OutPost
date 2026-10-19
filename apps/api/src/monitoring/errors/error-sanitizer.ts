import { createHash } from 'node:crypto';
import type { Environment, ErrorSeverity } from '@prisma/client';
import { redactSecrets } from '../../common/crypto';

const SECRET_KEY = /password|passwd|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key/i;
const MAX_METADATA_CHARS = 12_000;

/** Strip common secrets and volatile identifiers from telemetry before persistence. */
export function sanitizeStackTrace(stack: string | undefined): string | null {
  if (!stack) return null;
  return redactSecrets(
    stack
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[JWT REDACTED]')
      .replace(/([?&](?:token|key|secret|access_token|code)=)[^&\s]+/gi, '$1[REDACTED]')
      .slice(0, 16_000),
    16_000,
  );
}

export function sanitizeMetadata(
  input: Record<string, unknown> | undefined,
  depth = 0,
): Record<string, unknown> | null {
  if (!input) return null;
  if (depth > 3) return { truncated: true } as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, 30)) {
    if (SECRET_KEY.test(key)) {
      output[key] = '[REDACTED]';
    } else if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      output[key] = typeof value === 'string' ? sanitizeText(value, 1000) : value;
    } else if (Array.isArray(value)) {
      output[key] = value.slice(0, 10).map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeMetadata(item as Record<string, unknown>, depth + 1)
          : typeof item === 'string'
            ? sanitizeText(item, 300)
            : item,
      );
    } else if (typeof value === 'object') {
      output[key] = sanitizeMetadata(value as Record<string, unknown>, depth + 1);
    }
  }
  const serialized = JSON.stringify(output);
  if (serialized.length > MAX_METADATA_CHARS) {
    return { truncated: true, note: 'Metadata exceeded the ingestion limit' };
  }
  return output;
}

function sanitizeText(value: string, max: number): string {
  return (
    redactSecrets(
      value
        .replace(/([?&](?:token|key|secret|access_token|code)=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[JWT REDACTED]'),
      max,
    ) ?? ''
  );
}

/** Group errors on stable message shape, not stack line numbers or request IDs. */
export function fingerprintError(input: {
  serviceName: string;
  errorType: string;
  message: string;
  environment: Environment;
}): string {
  const normalized = input.message
    .toLowerCase()
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      '<uuid>',
    )
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[a-f0-9]{16,}\b/gi, '<id>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'<value>'")
    .replace(/"(?:[^"\\]|\\.)*"/g, '"<value>"')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '<email>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return createHash('sha256')
    .update(
      `${input.environment}|${input.serviceName.toLowerCase()}|${input.errorType.toLowerCase()}|${normalized}`,
    )
    .digest('hex');
}

export function normalizeEnvironment(value: string | undefined): Environment {
  const normalized = (value || 'production').trim().toUpperCase();
  if (normalized === 'PROD') return 'PRODUCTION';
  if (normalized === 'DEV') return 'DEVELOPMENT';
  if (normalized === 'STAGE' || normalized === 'STAGING') return 'STAGING';
  if (normalized === 'TESTING') return 'TEST';
  if (['PRODUCTION', 'STAGING', 'DEVELOPMENT', 'TEST'].includes(normalized)) {
    return normalized as Environment;
  }
  throw new Error('Invalid environment');
}

export function deriveSeverity(httpStatus: number | undefined): ErrorSeverity {
  if (httpStatus && httpStatus >= 500) return 'ERROR';
  if (httpStatus && httpStatus >= 400) return 'WARNING';
  return 'ERROR';
}
