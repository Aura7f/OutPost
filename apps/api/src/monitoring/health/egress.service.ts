import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EgressMode } from '@prisma/client';

export interface EgressChoice {
  mode: EgressMode;
  region: string | null;
}

@Injectable()
export class EgressService {
  private readonly proxies: string[];
  private readonly regions: string[];
  private proxyCursor = 0;

  constructor(private readonly config: ConfigService) {
    this.proxies = splitList(config.get<string>('MONITOR_PROXY_URLS', ''));
    this.regions = splitList(config.get<string>('CHECKER_REGIONS', ''));
  }

  hasProxies(): boolean {
    return this.proxies.length > 0;
  }

  proxyCount(): number {
    return this.proxies.length;
  }

  regionList(): string[] {
    return [...this.regions];
  }

  /** Round-robin across configured proxies so consecutive checks egress from different IPs. */
  nextProxy(): string | null {
    if (this.proxies.length === 0) return null;
    const proxy = this.proxies[this.proxyCursor % this.proxies.length]!;
    this.proxyCursor = (this.proxyCursor + 1) % this.proxies.length;
    return proxy;
  }

  assertChoice(mode: EgressMode, region?: string | null): EgressChoice {
    if (mode === EgressMode.PROXY) {
      if (!this.hasProxies()) {
        throw new BadRequestException(
          'Proxy egress is not available: MONITOR_PROXY_URLS is not configured on the API',
        );
      }
      return { mode, region: null };
    }
    if (mode === EgressMode.REGION) {
      const selected = region?.trim();
      if (!selected) {
        throw new BadRequestException('A region is required when egress mode is REGION');
      }
      if (!this.regions.includes(selected)) {
        throw new BadRequestException(
          this.regions.length
            ? `Unknown checker region "${selected}". Available regions: ${this.regions.join(', ')}`
            : 'Region egress is not available: no checker agents are configured (CHECKER_REGIONS)',
        );
      }
      return { mode, region: selected };
    }
    return { mode: EgressMode.DEFAULT, region: null };
  }
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
