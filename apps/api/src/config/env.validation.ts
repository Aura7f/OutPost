/**
 * Fail fast on configuration that would make Outpost insecure or unusable.
 * Optional integrations (Resend, Supabase JWKS) are validated lazily and
 * surface clear "not configured" errors at use time.
 */
export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const env = { ...config };
  const errors: string[] = [];
  const isProduction = env.NODE_ENV === 'production';

  const required = ['DATABASE_URL', 'SUPABASE_URL', 'ENCRYPTION_KEY'];
  for (const key of required) {
    if (!env[key] || String(env[key]).trim().length === 0) errors.push(`${key} is required`);
  }

  if (env.ENCRYPTION_KEY) {
    let keyBytes = 0;
    try {
      keyBytes = Buffer.from(String(env.ENCRYPTION_KEY), 'base64').length;
    } catch {
      keyBytes = 0;
    }
    if (keyBytes !== 32) {
      errors.push('ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
  }

  if (isProduction) {
    if (!env.CRON_SECRET || String(env.CRON_SECRET).length < 32) {
      errors.push('CRON_SECRET must be at least 32 characters in production');
    }
    if (!env.SUPABASE_JWT_SECRET && !env.SUPABASE_JWKS_URL) {
      // The default JWKS URL is derived from SUPABASE_URL.
      env.SUPABASE_JWKS_URL = `${String(env.SUPABASE_URL || '').replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`;
    }
    if (!env.RESEND_API_KEY) {
      // Email can be intentionally disabled; monitor delivery will be logged as failed.
      // Keep a warning out of startup failure so a monitoring outage can still be observed.
      env.EMAIL_CONFIGURED = 'false';
    }
    if (!env.WEB_URL) errors.push('WEB_URL is required in production');
    if (!env.DATABASE_URL?.toString().includes('sslmode=')) {
      // Supabase requires TLS. The query parameter is not mandatory with their pooler,
      // but unreachable startup is easier to diagnose than silently sending plaintext.
      // eslint-disable-next-line no-console
      console.warn('[config] DATABASE_URL has no sslmode parameter; ensure TLS is enabled.');
    }
  }

  const concurrency = Number(env.MONITORING_CONCURRENCY ?? 5);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
    errors.push('MONITORING_CONCURRENCY must be an integer between 1 and 50');
  }

  const retention = Number(env.DEFAULT_RETENTION_DAYS ?? 90);
  if (!Number.isInteger(retention) || retention < 7 || retention > 3650) {
    errors.push('DEFAULT_RETENTION_DAYS must be an integer between 7 and 3650');
  }
  env.DEFAULT_RETENTION_DAYS = retention;
  env.MONITORING_CONCURRENCY = concurrency;

  if (errors.length > 0) {
    throw new Error(`Invalid Outpost configuration:\n- ${errors.join('\n- ')}`);
  }
  return env;
}
