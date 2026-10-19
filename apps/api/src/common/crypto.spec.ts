import { randomBytes } from 'node:crypto';
import {
  EncryptionService,
  generateToken,
  redactSecrets,
  safeEqual,
  sha256,
} from './crypto';

describe('crypto utilities', () => {
  const primaryKey = randomBytes(32).toString('base64');
  const otherKey = randomBytes(32).toString('base64');

  it('round-trips encrypted integration credentials', () => {
    const service = new EncryptionService(primaryKey);
    const credentials = {
      supabaseUrl: 'https://example.supabase.co',
      apiKey: 'sb_publishable_value',
      nested: { databaseUrl: 'postgresql://readonly:secret@db.example.com:5432/app' },
    };

    const ciphertext = service.encrypt(credentials);
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain('sb_publishable_value');
    expect(service.decrypt(ciphertext)).toEqual(credentials);
  });

  it('rejects tampered ciphertext and the wrong key', () => {
    const service = new EncryptionService(primaryKey);
    const ciphertext = service.encrypt({ apiKey: 'value' });
    const tampered = `${ciphertext.slice(0, -2)}aa`;

    expect(() => service.decrypt(tampered)).toThrow();
    expect(() => new EncryptionService(otherKey).decrypt(ciphertext)).toThrow();
  });

  it('re-encrypts credentials during key rotation', () => {
    const oldService = new EncryptionService(primaryKey);
    const rotatedService = new EncryptionService(otherKey, primaryKey);
    const rotated = rotatedService.rotate(oldService.encrypt({ apiKey: 'narrow-key' }));

    expect(rotatedService.decrypt(rotated)).toEqual({ apiKey: 'narrow-key' });
    expect(() => new EncryptionService(otherKey).decrypt(oldService.encrypt({ apiKey: 'x' }))).toThrow();
  });

  it('generates prefixed tokens and stable hashes', () => {
    const first = generateToken('opk');
    const second = generateToken('opk');

    expect(first).toMatch(/^opk_/);
    expect(first).not.toBe(second);
    expect(sha256('value')).toBe(sha256('value'));
    expect(sha256('value')).toHaveLength(64);
  });

  it('compares secrets without leaking length information', () => {
    expect(safeEqual('same-value', 'same-value')).toBe(true);
    expect(safeEqual('same-value', 'other-value')).toBe(false);
    expect(safeEqual('short', 'longer-value')).toBe(false);
  });

  it('redacts connection strings, headers, JWTs, and named secrets', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl';
    const redacted = redactSecrets(
      `postgresql://admin:hunter2@db.example.com/app ${jwt} Authorization: Bearer abc123 password=hunter2`,
    );

    expect(redacted).toContain('postgresql://[REDACTED]');
    expect(redacted).toContain('[JWT REDACTED]');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('abc123');
    expect(redacted).not.toContain(jwt);
  });

  it('returns null for empty stack/error input', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets('')).toBeNull();
  });
});
