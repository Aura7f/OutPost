import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { decodeJwt } from 'jose';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import {
  ExchangeSessionDto,
  LoginDto,
  RecoverPasswordDto,
  ResendVerificationDto,
  ResetPasswordDto,
  SignupDto,
  UpdateProfileDto,
} from './auth.dto';
import { CurrentUser, Public } from '../common/decorators';
import type { AuthenticatedUser, OutpostRequest } from '../common/types';
import {
  clearSessionCookies,
  readAccessCookie,
  readRefreshCookie,
  setSessionCookies,
  type AuthCookieOptions,
  type CookieSameSite,
} from './auth-cookies';
import {
  SupabaseAuthClient,
  SupabaseAuthError,
  type SupabaseSession,
} from './supabase-auth.client';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly supabase: SupabaseAuthClient,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in and set HTTP-only session cookies' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ authenticated: true }> {
    const session = await this.mapAuthErrors(() =>
      this.supabase.signInWithPassword(dto.email.trim().toLowerCase(), dto.password),
    );
    setSessionCookies(response, session, this.cookieOptions());
    return { authenticated: true };
  }

  @Public()
  @Post('signup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create an account and set session cookies when confirmed' })
  async signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ authenticated: boolean; needsEmailConfirmation: boolean }> {
    const session = await this.mapAuthErrors(() =>
      this.supabase.signUp(
        dto.email.trim().toLowerCase(),
        dto.password,
        dto.fullName?.trim() || undefined,
        this.callbackUrl(dto.next),
      ),
    );
    if (!session) return { authenticated: false, needsEmailConfirmation: true };
    setSessionCookies(response, session, this.cookieOptions());
    return { authenticated: true, needsEmailConfirmation: false };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the session using the refresh cookie' })
  async refresh(
    @Req() request: OutpostRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ authenticated: true }> {
    const refreshToken = readRefreshCookie(request);
    if (!refreshToken) {
      clearSessionCookies(response, this.cookieOptions());
      throw new UnauthorizedException('No active session');
    }
    try {
      const session = await this.supabase.refresh(refreshToken);
      setSessionCookies(response, session, this.cookieOptions());
      return { authenticated: true };
    } catch (error) {
      clearSessionCookies(response, this.cookieOptions());
      throw this.toHttpException(error);
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current session and clear cookies' })
  async logout(
    @Req() request: OutpostRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ authenticated: false }> {
    const accessToken = readAccessCookie(request);
    if (accessToken) {
      await this.supabase.signOut(accessToken).catch(() => undefined);
    }
    clearSessionCookies(response, this.cookieOptions());
    return { authenticated: false };
  }

  @Public()
  @Post('recover')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a password recovery link' })
  async recover(@Body() dto: RecoverPasswordDto): Promise<{ sent: true }> {
    await this.mapAuthErrors(() =>
      this.supabase.sendRecovery(dto.email.trim().toLowerCase(), this.callbackUrl()),
    );
    return { sent: true };
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend the signup verification link' })
  async resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<{ sent: true }> {
    await this.mapAuthErrors(() =>
      this.supabase.resendVerification(dto.email.trim().toLowerCase(), this.callbackUrl()),
    );
    return { sent: true };
  }

  @Public()
  @Post('callback')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange email-link tokens for HTTP-only session cookies' })
  async callback(
    @Body() dto: ExchangeSessionDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ authenticated: true }> {
    try {
      await this.supabase.getUser(dto.accessToken);
    } catch (error) {
      clearSessionCookies(response, this.cookieOptions());
      throw this.toHttpException(error);
    }
    const session: SupabaseSession = {
      accessToken: dto.accessToken,
      refreshToken: dto.refreshToken,
      expiresIn: tokenExpirySeconds(dto.accessToken),
      user: { id: '' },
    };
    setSessionCookies(response, session, this.cookieOptions());
    return { authenticated: true };
  }

  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password for the signed-in recovery session' })
  async resetPassword(
    @Req() request: OutpostRequest,
    @Body() dto: ResetPasswordDto,
  ): Promise<{ updated: true }> {
    if (!request.accessToken) throw new UnauthorizedException('No active session');
    await this.mapAuthErrors(() =>
      this.supabase.updatePassword(request.accessToken!, dto.password),
    );
    return { updated: true };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated profile and team memberships' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.sync(user);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Create/refresh the local profile after authentication' })
  sync(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.sync(user);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the current user profile' })
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user, dto);
  }

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Public authentication capability flags' })
  config() {
    return { provider: 'supabase', emailVerificationRequired: true };
  }

  private cookieOptions(): AuthCookieOptions {
    const configured = (this.configService.get<string>('AUTH_COOKIE_SAMESITE') || 'lax').toLowerCase();
    const sameSite: CookieSameSite =
      configured === 'none' ? 'none' : configured === 'strict' ? 'strict' : 'lax';
    return {
      secure: this.configService.get<string>('NODE_ENV') === 'production' || sameSite === 'none',
      sameSite,
    };
  }

  private webUrl(): string {
    const raw =
      this.configService.get<string>('WEB_URL') ||
      this.configService.get<string>('CORS_ORIGINS') ||
      'http://localhost:5173';
    return raw.split(',')[0].trim().replace(/\/+$/, '');
  }

  private callbackUrl(next?: string): string {
    const safeNext =
      next && next.startsWith('/') && !next.startsWith('//') ? next : undefined;
    if (!safeNext) return `${this.webUrl()}/auth/callback`;
    return `${this.webUrl()}/auth/callback?next=${encodeURIComponent(safeNext)}`;
  }

  private async mapAuthErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  private toHttpException(error: unknown): unknown {
    if (!(error instanceof SupabaseAuthError)) return error;
    const message = error.message;
    let status = error.status;
    if (
      error.code === 'invalid_credentials' ||
      error.code === 'invalid_grant' ||
      /invalid login credentials/i.test(message)
    ) {
      status = 401;
    } else if (/email not confirmed/i.test(message)) {
      status = 403;
    } else if (
      error.code === 'user_already_exists' ||
      /already registered|already exists/i.test(message)
    ) {
      status = 409;
    } else if (status < 400 || status >= 500) {
      status = 502;
    }
    return new HttpException({ statusCode: status, message, code: error.code }, status);
  }
}

function tokenExpirySeconds(token: string): number {
  try {
    const payload = decodeJwt(token);
    if (typeof payload.exp === 'number') {
      return Math.max(60, payload.exp - Math.floor(Date.now() / 1000));
    }
  } catch {
  }
  return 3600;
}
