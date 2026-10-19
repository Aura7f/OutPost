import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export interface ResolvedTarget {
  hostname: string;
  address: string;
  family: 4 | 6;
}

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.lan',
  '.intranet',
];

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

/**
 * Prevents server-side request forgery for customer-configured monitors.
 * URLs are resolved at check time and the validated address is pinned in the
 * socket lookup so a second DNS answer cannot redirect the connection.
 */
@Injectable()
export class SsrfGuard {
  private readonly logger = new Logger(SsrfGuard.name);
  private readonly allowedPorts: Set<string>;
  private readonly allowPrivate: boolean;
  private readonly extraBlocked: Set<string>;

  constructor(private readonly config: ConfigService) {
    const rawPorts = config.get<string>('SSRF_ALLOWED_PORTS', '80,443');
    this.allowedPorts = new Set(
      rawPorts
        .split(',')
        .map((port) => port.trim())
        .filter(Boolean),
    );
    this.allowPrivate =
      config.get<string>('SSRF_ALLOW_PRIVATE_NETWORKS', 'false') === 'true' &&
      config.get<string>('NODE_ENV') !== 'production';
    this.extraBlocked = new Set(
      config
        .get<string>('MONITOR_BLOCKED_HOSTS', '')
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
    if (this.allowPrivate) {
      this.logger.warn('SSRF private-network protection is disabled (development only)');
    }
  }

  validateUrlSyntax(rawUrl: string): URL {
    if (!rawUrl || rawUrl.length > 2048) throw new BadRequestException('Invalid monitoring URL');
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Monitoring URL must be a valid absolute URL');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('Only HTTP and HTTPS monitoring endpoints are supported');
    }
    if (url.username || url.password) {
      throw new BadRequestException('Monitoring URLs must not contain embedded credentials');
    }
    if (!this.allowedPorts.has(url.port || (url.protocol === 'https:' ? '443' : '80'))) {
      throw new BadRequestException(
        `Port ${url.port} is not allowed for monitoring. Allowed ports: ${[...this.allowedPorts].join(', ')}`,
      );
    }
    if (url.hostname.length > 253) throw new BadRequestException('Hostname is too long');
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (this.extraBlocked.has(hostname)) {
      throw new BadRequestException('This host is blocked by monitoring policy');
    }
    if (BLOCKED_HOSTS.has(hostname) || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      throw new BadRequestException('Monitoring internal or local hosts is not permitted');
    }
    return url;
  }

  /** Full SSRF resolution used immediately before each outbound request. */
  async resolve(rawUrl: string): Promise<{ url: URL; target: ResolvedTarget | null }> {
    const url = this.validateUrlSyntax(rawUrl);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (ipaddr.isValid(hostname)) {
      if (!this.allowPrivate && !this.isPublic(hostname)) {
        throw new BadRequestException('Monitoring private, loopback, or reserved addresses is not permitted');
      }
      return {
        url,
        target: {
          hostname: url.hostname,
          address: hostname,
          family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6,
        },
      };
    }

    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException('Unable to resolve monitoring hostname');
    }
    if (!addresses.length) throw new BadRequestException('Monitoring hostname did not resolve');

    for (const entry of addresses) {
      if (!this.allowPrivate && !this.isPublic(entry.address)) {
        throw new BadRequestException('Monitoring host resolves to a private or reserved address');
      }
    }
    const selected = addresses.find((entry) => entry.family === 4) ?? addresses[0];
    return {
      url,
      target: {
        hostname,
        address: selected.address,
        family: selected.family === 6 ? 6 : 4,
      },
    };
  }

  isPublic(address: string): boolean {
    if (!ipaddr.isValid(address)) return false;
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6') {
      const ipv6 = parsed as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) parsed = ipv6.toIPv4Address();
      else {
        // Only globally routable IPv6 unicast is permitted. This blocks link-local,
        // unique-local, loopback, multicast, Teredo, 6to4, and NAT64 forms.
        return parsed.range() === 'unicast';
      }
    }
    return parsed.range() === 'unicast';
  }
}
