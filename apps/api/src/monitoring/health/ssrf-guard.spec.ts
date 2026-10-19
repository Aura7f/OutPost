import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SsrfGuard } from './ssrf-guard';

function createGuard(overrides: Record<string, string> = {}): SsrfGuard {
  const values: Record<string, string> = {
    SSRF_ALLOWED_PORTS: '80,443',
    SSRF_ALLOW_PRIVATE_NETWORKS: 'false',
    NODE_ENV: 'test',
    MONITOR_BLOCKED_HOSTS: '',
    ...overrides,
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
  return new SsrfGuard(config);
}

describe('SsrfGuard', () => {
  const guard = createGuard();

  it('allows globally routable IPv4 and IPv6 addresses', () => {
    expect(guard.isPublic('8.8.8.8')).toBe(true);
    expect(guard.isPublic('1.1.1.1')).toBe(true);
    expect(guard.isPublic('2606:4700:4700::1111')).toBe(true);
    expect(guard.isPublic('::ffff:8.8.8.8')).toBe(true);
  });

  it('blocks loopback, private, link-local, and reserved ranges', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(guard.isPublic(address)).toBe(false);
    }
  });

  it('accepts only HTTP(S) URLs on allow-listed ports', () => {
    expect(guard.validateUrlSyntax('https://example.com').hostname).toBe('example.com');
    expect(guard.validateUrlSyntax('http://example.com:80/health').port).toBe('');

    expect(() => guard.validateUrlSyntax('ftp://example.com')).toThrow(BadRequestException);
    expect(() => guard.validateUrlSyntax('https://example.com:8443')).toThrow('not allowed');
    expect(() => guard.validateUrlSyntax('https://user:pass@example.com')).toThrow(
      'embedded credentials',
    );
    expect(() => guard.validateUrlSyntax('not-a-url')).toThrow('valid absolute URL');
    expect(() => guard.validateUrlSyntax(`https://example.com/${'a'.repeat(2100)}`)).toThrow(
      'Invalid monitoring URL',
    );
  });

  it('blocks internal hostnames and configured deny-list entries', () => {
    expect(() => guard.validateUrlSyntax('http://localhost')).toThrow('internal or local');
    expect(() => guard.validateUrlSyntax('http://api.internal')).toThrow('internal or local');
    expect(() => guard.validateUrlSyntax('http://metadata.google.internal')).toThrow(
      'internal or local',
    );

    const configured = createGuard({ MONITOR_BLOCKED_HOSTS: 'evil.example.com' });
    expect(() => configured.validateUrlSyntax('https://evil.example.com')).toThrow('blocked');
  });

  it('pins literal IPs without a second DNS lookup', async () => {
    const resolved = await guard.resolve('https://8.8.8.8/health');
    expect(resolved.target).toMatchObject({ address: '8.8.8.8', family: 4 });

    await expect(guard.resolve('http://127.0.0.1/')).rejects.toThrow('not permitted');
    await expect(guard.resolve('http://[::1]/')).rejects.toThrow('not permitted');
  });

  it('can explicitly allow private networks in development', async () => {
    const development = createGuard({
      SSRF_ALLOW_PRIVATE_NETWORKS: 'true',
      NODE_ENV: 'development',
    });
    const resolved = await development.resolve('http://127.0.0.1:80/health');
    expect(resolved.target?.address).toBe('127.0.0.1');
  });
});
