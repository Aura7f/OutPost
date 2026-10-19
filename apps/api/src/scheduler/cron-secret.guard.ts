import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Protects the internal scheduler endpoint. Supabase Cron calls it with
 * `Authorization: Bearer <CRON_SECRET>`; self-hosted cron may use
 * `X-Cron-Secret` instead. Values are hashed before comparison so the check
 * does not leak the expected length or prefix through timing.
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('CRON_SECRET');
    if (!expected) {
      // Do not expose whether a missing secret is a configuration error to callers.
      throw new UnauthorizedException('Scheduler endpoint is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-cron-secret'];
    const supplied = Array.isArray(header) ? header[0] : header;
    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : undefined;
    const candidate = supplied || bearer;
    if (!candidate) throw new UnauthorizedException('Missing scheduler credentials');

    const expectedDigest = createHash('sha256').update(expected).digest();
    const suppliedDigest = createHash('sha256').update(candidate).digest();
    if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
      throw new UnauthorizedException('Invalid scheduler credentials');
    }
    return true;
  }
}
