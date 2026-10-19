import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

/**
 * AES-256-GCM encryption for integration credentials.
 * Ciphertext format: v1.<iv-b64url>.<tag-b64url>.<ciphertext-b64url>
 */
export class EncryptionService {
  private readonly keys: Buffer[];

  constructor(primaryKeyBase64: string, previousKeyBase64?: string) {
    const primary = Buffer.from(primaryKeyBase64, 'base64');
    if (primary.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes');
    this.keys = [primary];
    if (previousKeyBase64) {
      const old = Buffer.from(previousKeyBase64, 'base64');
      if (old.length !== 32) throw new Error('ENCRYPTION_KEY_OLD must be 32 bytes');
      this.keys.push(old);
    }
  }

  encrypt(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys[0], iv);
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt<T = Record<string, unknown>>(payload: string): T {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('Unsupported credential payload format');
    }
    const [, ivPart, tagPart, dataPart] = parts;
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    const ciphertext = Buffer.from(dataPart, 'base64url');
    let lastError: Error | undefined;
    for (const key of this.keys) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(plaintext.toString('utf8')) as T;
      } catch (error) {
        lastError = error as Error;
      }
    }
    throw new Error(`Unable to decrypt credential: ${lastError?.message ?? 'invalid key'}`);
  }

  /** Re-encrypt with the current key after a rotation. */
  rotate(payload: string): string {
    return this.encrypt(this.decrypt(payload));
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateToken(prefix = 'outpost'): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Redact obvious secrets from errors before persisting them. */
export function redactSecrets(input: string | null | undefined, max = 1000): string | null {
  if (!input) return null;
  return input
    .replace(/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi, '$1://[REDACTED]')
    // Authorization and Cookie headers can contain spaces (Bearer/Basic).
    // Redact through the end of the line so the credential itself never leaks.
    .replace(/\b(authorization|cookie)\s*[:=]\s*[^\r\n]+/gi, '$1=[REDACTED]')
    .replace(/\b(apikey|x-api-key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[JWT REDACTED]')
    .replace(/(secret|token|password|key)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, max);
}
