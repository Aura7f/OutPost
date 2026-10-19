import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, decodeJwt, jwtVerify, JWTPayload } from 'jose';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../common/decorators';
import type { OutpostRequest } from '../common/types';
import { ACCESS_COOKIE } from './auth-cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OutpostRequest>();
    if (
      !SAFE_METHODS.has(request.method.toUpperCase()) &&
      !this.isAllowedOrigin(request.headers.origin)
    ) {
      throw new ForbiddenException('Cross-site request blocked');
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const cookieToken = request.cookies?.[ACCESS_COOKIE];
    const token = bearer || cookieToken;
    if (!token) throw new UnauthorizedException('Authentication required');

    let payload: JWTPayload;
    try {
      payload = await this.verifyToken(token);
    } catch (error) {
      this.logger.debug(`JWT verification failed: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid or expired session');
    }

    const supabaseUserId = payload.sub;
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    if (!supabaseUserId || !email) {
      throw new UnauthorizedException('Token does not contain an email identity');
    }

    const metadata = (payload.user_metadata ?? {}) as Record<string, unknown>;
    const fullName =
      (typeof metadata.full_name === 'string' && metadata.full_name) ||
      (typeof metadata.name === 'string' && metadata.name) ||
      null;
    const avatarUrl = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null;

    const profile = await this.prisma.userProfile.upsert({
      where: { supabaseUserId },
      create: {
        supabaseUserId,
        email: email.toLowerCase(),
        fullName,
        avatarUrl,
      },
      update: {
        email: email.toLowerCase(),
      },
      select: { id: true, fullName: true, avatarUrl: true, email: true },
    });

    request.accessToken = token;
    request.user = {
      profileId: profile.id,
      supabaseUserId,
      email: profile.email,
      fullName: profile.fullName,
      avatarUrl: profile.avatarUrl,
    };
    return true;
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    const configured = (
      this.config.get<string>('CORS_ORIGINS') ||
      this.config.get<string>('WEB_URL') ||
      'http://localhost:5173'
    )
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (configured.includes('*')) return true;
    return configured.some((allowed) => allowed.replace(/\/+$/, '') === origin);
  }

  private async verifyToken(token: string): Promise<JWTPayload> {
    const audience = this.config.get<string>('SUPABASE_JWT_AUDIENCE', 'authenticated');
    const secret = this.config.get<string>('SUPABASE_JWT_SECRET');
    const issuer = `${this.config.getOrThrow<string>('SUPABASE_URL').replace(/\/+$/, '')}/auth/v1`;

    if (secret) {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        audience,
        issuer,
      });
      return payload;
    }

    if (!this.jwks) {
      const jwksUrl =
        this.config.get<string>('SUPABASE_JWKS_URL') || `${issuer}/.well-known/jwks.json`;
      this.jwks = createRemoteJWKSet(new URL(jwksUrl), {
        timeoutDuration: 5000,
        cooldownDuration: 30_000,
      });
    }
    try {
      const { payload } = await jwtVerify(token, this.jwks, { audience, issuer });
      return payload;
    } catch (error) {
      // Older Supabase projects may issue legacy HS256 tokens even when JWKS is configured.
      if (!secret) throw error;
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        audience,
      });
      return payload;
    }
  }
}
