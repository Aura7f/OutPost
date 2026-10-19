import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { SsrfGuard } from '../health/ssrf-guard';
import { redactSecrets } from '../../common/crypto';

export interface MetricSnapshot {
  connectivity: boolean;
  connectionLatencyMs: number | null;
  activeConnections: number | null;
  maxConnections: number | null;
  databaseSizeBytes: bigint | null;
  longRunningQueries: number | null;
  locks: number | null;
  slowQueries: Array<{
    query: string;
    calls: number;
    totalExecTimeMs: number;
    meanExecTimeMs: number;
    rows: number;
  }> | null;
  transactionStats: {
    commits: number;
    rollbacks: number;
    blocksRead: number;
    blocksHit: number;
  } | null;
  unavailableReasons: Record<string, string>;
  error: string | null;
}

export interface DatabaseMetricsProvider {
  readonly type: string;
  collect(databaseUrl: string, timeoutMs?: number): Promise<MetricSnapshot>;
}

/**
 * Least-privilege PostgreSQL metrics collector. The monitoring role should have
 * CONNECT plus pg_read_all_stats (for pg_stat_activity and pg_stat_statements).
 * No write privileges are required.
 */
@Injectable()
export class PostgresMetricsProvider implements DatabaseMetricsProvider {
  readonly type = 'POSTGRESQL';
  private readonly logger = new Logger(PostgresMetricsProvider.name);

  constructor(private readonly ssrf: SsrfGuard) {}

  async collect(databaseUrl: string, timeoutMs = 10_000): Promise<MetricSnapshot> {
    const unavailable: Record<string, string> = {};
    let client: PoolClient | null = null;
    let pool: Pool | null = null;
    const startedAt = Date.now();
    try {
      const connection = await this.resolveConnection(databaseUrl);
      pool = new Pool({
        host: connection.host,
        port: connection.port,
        user: connection.user,
        password: connection.password,
        database: connection.database,
        ssl: connection.ssl,
        max: 1,
        min: 0,
        connectionTimeoutMillis: 8000,
        idleTimeoutMillis: 3000,
        application_name: 'outpost-monitor',
        keepAlive: true,
      });
      pool.on('error', (error) => this.logger.warn(`Idle metrics connection error: ${error.message}`));
      client = await pool.connect();
      await client.query(`SET statement_timeout = ${Math.max(2000, Math.min(timeoutMs, 20_000))}`);
      const connectionStarted = Date.now();
      await client.query('SELECT 1');
      const connectionLatencyMs = Date.now() - connectionStarted;

      const connectionStats = (
        await this.querySafely<{
          active: string;
          total: string;
          max_connections: string;
        }>(
          client,
          `SELECT
             count(*) FILTER (WHERE state = 'active' AND datname = current_database())::text AS active,
             count(*) FILTER (WHERE datname = current_database())::text AS total,
             current_setting('max_connections')::text AS max_connections
           FROM pg_stat_activity`,
          'connections',
          unavailable,
        )
      )?.[0];

      const sizeResult = (
        await this.querySafely<{ size: string }>(
          client,
          'SELECT pg_database_size(current_database())::text AS size',
          'databaseSize',
          unavailable,
        )
      )?.[0];

      const longRunning = (
        await this.querySafely<{ count: string }>(
          client,
          `SELECT count(*)::text AS count
           FROM pg_stat_activity
           WHERE datname = current_database()
             AND state = 'active'
             AND pid <> pg_backend_pid()
             AND now() - query_start > interval '30 seconds'`,
          'longRunningQueries',
          unavailable,
        )
      )?.[0];

      const locks = (
        await this.querySafely<{ count: string }>(
          client,
          'SELECT count(*)::text AS count FROM pg_locks',
          'locks',
          unavailable,
        )
      )?.[0];

      const xact = (
        await this.querySafely<{
          commits: string;
          rollbacks: string;
          blocks_read: string;
          blocks_hit: string;
        }>(
          client,
          `SELECT sum(xact_commit)::text AS commits,
                  sum(xact_rollback)::text AS rollbacks,
                  sum(blks_read)::text AS blocks_read,
                  sum(blks_hit)::text AS blocks_hit
           FROM pg_stat_database
           WHERE datname = current_database()`,
          'transactionStats',
          unavailable,
        )
      )?.[0];

      let slowQueries: MetricSnapshot['slowQueries'] = null;
      const extension = (
        await this.querySafely<{ exists: boolean }>(
          client,
          `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS exists`,
          'slowQueries',
          unavailable,
        )
      )?.[0];
      if (extension?.exists) {
        const rows = await this.querySafely<{
          query: string;
          calls: string;
          total_exec_time: number;
          mean_exec_time: number;
          rows: string;
        }>(
          client,
          `SELECT query,
                  calls::text AS calls,
                  total_exec_time,
                  mean_exec_time,
                  rows::text AS rows
           FROM pg_stat_statements
           WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
           ORDER BY total_exec_time DESC
           LIMIT 5`,
          'slowQueries',
          unavailable,
        );
        if (rows) {
          slowQueries = rows.map((row) => ({
            query: sanitizeSql(row.query),
            calls: Number(row.calls) || 0,
            totalExecTimeMs: Math.round(Number(row.total_exec_time) || 0),
            meanExecTimeMs: Math.round((Number(row.mean_exec_time) || 0) * 100) / 100,
            rows: Number(row.rows) || 0,
          }));
        }
      } else if (!unavailable.slowQueries) {
        unavailable.slowQueries = 'pg_stat_statements is not enabled on this project';
      }

      return {
        connectivity: true,
        connectionLatencyMs,
        activeConnections: connectionStats ? Number(connectionStats.active) : null,
        maxConnections: connectionStats ? Number(connectionStats.max_connections) : null,
        databaseSizeBytes: sizeResult ? BigInt(sizeResult.size) : null,
        longRunningQueries: longRunning ? Number(longRunning.count) : null,
        locks: locks ? Number(locks.count) : null,
        slowQueries,
        transactionStats: xact
          ? {
              commits: Number(xact.commits) || 0,
              rollbacks: Number(xact.rollbacks) || 0,
              blocksRead: Number(xact.blocks_read) || 0,
              blocksHit: Number(xact.blocks_hit) || 0,
            }
          : null,
        unavailableReasons: unavailable,
        error: null,
      };
    } catch (error) {
      return {
        connectivity: false,
        connectionLatencyMs: Date.now() - startedAt,
        activeConnections: null,
        maxConnections: null,
        databaseSizeBytes: null,
        longRunningQueries: null,
        locks: null,
        slowQueries: null,
        transactionStats: null,
        unavailableReasons: unavailable,
        error: redactSecrets(this.describeDatabaseError(error), 500),
      };
    } finally {
      client?.release();
      await pool?.end().catch(() => undefined);
    }
  }

  private async querySafely<T extends QueryResultRow>(
    client: PoolClient,
    sql: string,
    metric: string,
    unavailable: Record<string, string>,
  ): Promise<T[] | null> {
    try {
      const result = await client.query<T>(sql);
      return result.rows;
    } catch (error) {
      unavailable[metric] =
        redactSecrets(`Metric unavailable: ${this.describeDatabaseError(error)}`, 220) ??
        'Metric unavailable';
      return null;
    }
  }

  private async resolveConnection(databaseUrl: string): Promise<{
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl: { rejectUnauthorized: boolean; servername?: string } | false;
  }> {
    let url: URL;
    try {
      url = new URL(databaseUrl);
    } catch {
      throw new Error('Invalid database connection string');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      throw new Error('Only PostgreSQL databases are supported');
    }
    const sslMode = url.searchParams.get('sslmode');
    const allowInsecure =
      process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_DATABASE_URL === 'true';
    if (sslMode === 'disable' && !allowInsecure) {
      throw new Error('TLS is required for database monitoring connections');
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const isIpLiteral = isIP(hostname) !== 0;
    let address = hostname;
    if (!isIpLiteral) {
      const resolved = await lookup(hostname, { all: true, verbatim: true });
      if (!resolved.length) throw new Error('Database hostname did not resolve');
      const allowPrivate =
        process.env.NODE_ENV !== 'production' && process.env.ALLOW_PRIVATE_DATABASE_HOSTS === 'true';
      for (const entry of resolved) {
        if (!allowPrivate && !this.ssrf.isPublic(entry.address)) {
          throw new Error('Database host resolves to a private or reserved address');
        }
      }
      const chosen = resolved.find((entry) => entry.family === 4) ?? resolved[0];
      address = chosen.address;
    } else if (!this.ssrf.isPublic(hostname)) {
      const allowPrivate =
        process.env.NODE_ENV !== 'production' && process.env.ALLOW_PRIVATE_DATABASE_HOSTS === 'true';
      if (!allowPrivate) {
        throw new Error('Private database addresses are not permitted');
      }
    }

    const port = url.port ? Number(url.port) : 5432;
    if (![5432, 6543].includes(port)) {
      throw new Error('Database metrics only support PostgreSQL ports 5432 and 6543');
    }
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const database = url.pathname.replace(/^\//, '');
    if (!user || !database) throw new Error('Database connection string is incomplete');

    return {
      host: address,
      port,
      user,
      password,
      database,
      ssl:
        sslMode === 'disable'
          ? false
          : { rejectUnauthorized: true, ...(isIpLiteral ? {} : { servername: hostname }) },
    };
  }

  private describeDatabaseError(error: unknown): string {
    const err = error as Error & { code?: string };
    if (err.code === '28P01') return 'Database authentication failed';
    if (err.code === '3D000') return 'Database does not exist';
    if (err.code === '42501') return 'Database role lacks monitoring privileges';
    if (err.code === 'ECONNREFUSED') return 'Database connection refused';
    if (err.code === 'ENOTFOUND') return 'Database hostname did not resolve';
    if (err.name === 'TimeoutError' || /timeout/i.test(err.message)) return 'Database connection timed out';
    return err.message || 'Database connection failed';
  }
}

function sanitizeSql(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\b\d{4,}\b/g, '?')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}
