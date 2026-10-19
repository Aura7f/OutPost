/**
 * Fail fast on configuration that would make Outpost insecure or unusable.
 * Optional integrations (Resend, Supabase JWKS) are validated lazily and
 * surface clear "not configured" errors at use time.
 */
export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const env = { ...config };
  const errors: string[] = [];
  const isProduction = env.NODE_ENV === 'production';

  const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ENCRYPTION_KEY'];
  for (const key of required) {
    if (!env[key] || String(env[key]).trim().length === 0) errors.push(`${key} is required`);
  }

  const anonKey = String(env.SUPABASE_ANON_KEY ?? '').trim();
  if (anonKey.startsWith('sb_secret_')) {
    errors.push('SUPABASE_ANON_KEY must be the publishable/anon key, never the secret key');
  } else if (anonKey.split('.').length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(anonKey.split('.')[1], 'base64url').toString('utf8'),
      ) as { role?: string };
      if (payload.role === 'service_role') {
        errors.push('SUPABASE_ANON_KEY must be the publishable/anon key, never the secret key');
      }
    } catch {
      errors.push('SUPABASE_ANON_KEY is not a valid Supabase key');
    }
  }

  const sameSite = String(env.AUTH_COOKIE_SAMESITE ?? 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    errors.push('AUTH_COOKIE_SAMESITE must be one of lax, strict, none');
  } else if (sameSite === 'none' && !isProduction) {
    errors.push('AUTH_COOKIE_SAMESITE=none requires HTTPS; use lax in development');
  }
  env.AUTH_COOKIE_SAMESITE = sameSite;

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

  const proxies = splitList(env.MONITOR_PROXY_URLS);
  for (const proxy of proxies) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(proxy);
    } catch {
      parsed = null;
    }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      errors.push(`MONITOR_PROXY_URLS contains an invalid proxy URL: ${proxy}`);
    }
  }

  const regions = splitList(env.CHECKER_REGIONS);
  for (const region of regions) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(region)) {
      errors.push(`CHECKER_REGIONS contains an invalid region id: ${region}`);
    }
  }
  const workerRegion = String(env.WORKER_REGION ?? '').trim();
  if (workerRegion && !regions.includes(workerRegion)) {
    errors.push('WORKER_REGION must be listed in CHECKER_REGIONS');
  }

  const checkerPoll = Number(env.CHECKER_POLL_SECONDS ?? 10);
  if (!Number.isInteger(checkerPoll) || checkerPoll < 2 || checkerPoll > 300) {
    errors.push('CHECKER_POLL_SECONDS must be an integer between 2 and 300');
  }
  env.CHECKER_POLL_SECONDS = checkerPoll;

  if (errors.length > 0) {
    throw new Error(`Invalid Outpost configuration:\n- ${errors.join('\n- ')}`);
  }
  return env;
}

function splitList(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
