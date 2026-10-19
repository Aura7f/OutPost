import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SupabaseSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SupabaseUser;
}

export interface SupabaseUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export class SupabaseAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SupabaseAuthError';
  }
}

interface TokenPayload {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: SupabaseUser;
}

@Injectable()
export class SupabaseAuthClient {
  private readonly logger = new Logger(SupabaseAuthClient.name);
  private readonly baseUrl: string;
  private readonly anonKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = `${this.config
      .getOrThrow<string>('SUPABASE_URL')
      .replace(/\/+$/, '')}/auth/v1`;
    this.anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');
  }

  async signInWithPassword(email: string, password: string): Promise<SupabaseSession> {
    const payload = await this.request<TokenPayload>('/token?grant_type=password', {
      method: 'POST',
      body: { email, password },
    });
    return this.toSession(payload, 'Unable to establish a session');
  }

  async signUp(
    email: string,
    password: string,
    fullName: string | undefined,
    redirectTo: string,
  ): Promise<SupabaseSession | null> {
    const payload = await this.request<TokenPayload>(
      `/signup?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: 'POST',
        body: {
          email,
          password,
          ...(fullName ? { data: { full_name: fullName } } : {}),
        },
      },
    );
    if (!payload.access_token || !payload.refresh_token) return null;
    return this.toSession(payload, 'Unable to establish a session');
  }

  async refresh(refreshToken: string): Promise<SupabaseSession> {
    const payload = await this.request<TokenPayload>('/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    });
    return this.toSession(payload, 'Unable to refresh the session');
  }

  async signOut(accessToken: string): Promise<void> {
    await this.request<void>('/logout', { method: 'POST', accessToken });
  }

  async sendRecovery(email: string, redirectTo: string): Promise<void> {
    await this.request<void>(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      body: { email },
    });
  }

  async resendVerification(email: string, redirectTo: string): Promise<void> {
    await this.request<void>(`/resend?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      body: { type: 'signup', email },
    });
  }

  async updatePassword(accessToken: string, password: string): Promise<SupabaseUser> {
    return this.request<SupabaseUser>('/user', {
      method: 'PUT',
      accessToken,
      body: { password },
    });
  }

  async getUser(accessToken: string): Promise<SupabaseUser> {
    return this.request<SupabaseUser>('/user', { method: 'GET', accessToken });
  }

  private toSession(payload: TokenPayload, fallback: string): SupabaseSession {
    if (!payload.access_token || !payload.refresh_token) {
      throw new SupabaseAuthError(fallback, 502);
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn: Number(payload.expires_in) || 3600,
      user: payload.user ?? { id: '' },
    };
  }

  private async request<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PUT';
      body?: Record<string, unknown>;
      accessToken?: string;
    },
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          apikey: this.anonKey,
          'Content-Type': 'application/json',
          ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      this.logger.warn(`Supabase Auth request failed: ${(error as Error).message}`);
      throw new SupabaseAuthError('Authentication service is unavailable', 503);
    }

    if (!response.ok) {
      let payload: Record<string, unknown> = {};
      try {
        payload = (await response.json()) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      const message =
        (typeof payload.msg === 'string' && payload.msg) ||
        (typeof payload.error_description === 'string' && payload.error_description) ||
        (typeof payload.message === 'string' && payload.message) ||
        (typeof payload.error === 'string' && payload.error) ||
        `Authentication request failed (${response.status})`;
      const code =
        (typeof payload.error_code === 'string' && payload.error_code) ||
        (typeof payload.code === 'string' ? payload.code : undefined);
      if (response.status >= 500) {
        this.logger.error(`Supabase Auth ${response.status}: ${message}`);
        throw new SupabaseAuthError('Authentication service is unavailable', 502, code);
      }
      throw new SupabaseAuthError(message, response.status, code);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}
