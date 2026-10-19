import { api } from './api';
import type { AuthMe } from './types';

export interface SignupResult {
  authenticated: boolean;
  needsEmailConfirmation: boolean;
}

export const authApi = {
  me: () => api<AuthMe>('/auth/me'),

  login: (email: string, password: string) =>
    api<{ authenticated: true }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuthRefresh: true,
    }),

  signup: (input: {
    email: string;
    password: string;
    fullName?: string;
    next?: string;
  }) =>
    api<SignupResult>('/auth/signup', {
      method: 'POST',
      body: input,
      skipAuthRefresh: true,
    }),

  logout: () =>
    api<{ authenticated: false }>('/auth/logout', {
      method: 'POST',
      skipAuthRefresh: true,
    }),

  recover: (email: string) =>
    api<{ sent: true }>('/auth/recover', {
      method: 'POST',
      body: { email },
      skipAuthRefresh: true,
    }),

  resendVerification: (email: string) =>
    api<{ sent: true }>('/auth/resend-verification', {
      method: 'POST',
      body: { email },
      skipAuthRefresh: true,
    }),

  exchangeSession: (accessToken: string, refreshToken: string) =>
    api<{ authenticated: true }>('/auth/callback', {
      method: 'POST',
      body: { accessToken, refreshToken },
      skipAuthRefresh: true,
    }),

  resetPassword: (password: string) =>
    api<{ updated: true }>('/auth/reset-password', {
      method: 'POST',
      body: { password },
    }),
};
