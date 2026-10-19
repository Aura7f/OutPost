import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { JobStatus, Prisma, ReportFrequency, ReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HealthCheckExecutor } from '../monitoring/health/health-check.executor';
import { HeartbeatService } from '../monitoring/heartbeat/heartbeat.service';
import { DatabaseMetricsService } from '../monitoring/database/database-metrics.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationService } from '../notifications/notification.service';
import { RetentionService } from './retention.service';
import { redactSecrets } from '../common/crypto';

interface ClaimedJob {
  id: string;
  type: string;
  monitorId: string | null;
  integrationId: string | null;
  reportId: string | null;
  reportScheduleId: string | null;
  region: string | null;
  scheduledFor: Date;
  attempts: number;
  maxAttempts: number;
}

interface EnqueueCounts {
  monitors: number;
  heartbeats: number;
  metrics: number;
  reports: number;
  notificationRetries: number;
  retention: number;
}

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  private readonly concurrency: number;
  private readonly lockTimeoutSeconds: number;
  private readonly defaultMaxAttempts: number;
  private readonly workerRegion: string | null;
  private readonly activeJobs = new Set<string>();
  private localTimer?: NodeJS.Timeout;
  private checkerTimer?: NodeJS.Timeout;
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly health: HealthCheckExecutor,
    private readonly heartbeat: HeartbeatService,
    private readonly databaseMetrics: DatabaseMetricsService,
    private readonly reports: ReportsService,
    private readonly notifications: NotificationService,
    private readonly retention: RetentionService,
  ) {
    this.concurrency = Number(config.get('MONITORING_CONCURRENCY', 5));
    this.lockTimeoutSeconds = Number(config.get('JOB_LOCK_TIMEOUT_SECONDS', 120));
    this.defaultMaxAttempts = Number(config.get('JOB_MAX_ATTEMPTS', 3));
    this.workerRegion = config.get<string>('WORKER_REGION', '')?.trim() || null;
  }

  onModuleInit(): void {
    if (this.workerRegion) {
      const pollMs = Math.max(2, Number(this.config.get('CHECKER_POLL_SECONDS', 10))) * 1000;
      this.logger.log(
        `Checker worker enabled for region ${this.workerRegion} (poll=${pollMs}ms, concurrency=${this.concurrency})`,
      );
      this.checkerTimer = setInterval(() => {
        void this.processQueue().catch((error) =>
          this.logger.error(`Checker poll failed: ${(error as Error).message}`),
        );
      }, pollMs);
      setTimeout(() => {
        void this.processQueue().catch(() => undefined);
      }, 3_000);
      return;
    }
    // In production Supabase Cron calls the secure dispatcher. Local interval
    // execution is opt-in for development and single-process self-hosting.
    if (this.config.get<string>('ALLOW_LOCAL_SCHEDULER') === 'true') {
      this.logger.log(`Local scheduler enabled (concurrency=${this.concurrency})`);
      this.localTimer = setInterval(() => {
        void this.dispatch().catch((error) =>
          this.logger.error(`Local scheduler dispatch failed: ${(error as Error).message}`),
        );
      }, 60_000);
      this.localTimer.unref?.();
      setTimeout(() => {
        void this.dispatch().catch(() => undefined);
      }, 8_000).unref?.();
    }
  }

  onModuleDestroy(): void {
    if (this.localTimer) clearInterval(this.localTimer);
    if (this.checkerTimer) clearInterval(this.checkerTimer);
  }

  /** Checker-worker loop: recover stale leases and claim only this region's jobs. */
  async processQueue(): Promise<number> {
    if (!this.workerRegion) throw new Error('processQueue requires WORKER_REGION');
    await this.recoverStaleJobs();
    const capacity = Math.max(0, this.concurrency - this.activeJobs.size);
    if (capacity === 0) return 0;
    const jobs = await this.claimJobs(capacity);
    if (jobs.length > 0) setImmediate(() => this.executeJobs(jobs));
    return jobs.length;
  }

  async dispatch(): Promise<{
    accepted: true;
    enqueued: EnqueueCounts;
    claimed: number;
    activeJobs: number;
    recovered: number;
  }> {
    if (this.dispatching) {
      return {
        accepted: true,
        enqueued: this.emptyEnqueueCounts(),
        claimed: 0,
        activeJobs: this.activeJobs.size,
        recovered: 0,
      };
    }
    this.dispatching = true;
    try {
      const recovered = await this.recoverStaleJobs();
      const enqueued = await this.enqueueDueWork();
      const capacity = Math.max(0, this.concurrency - this.activeJobs.size);
      const jobs = capacity > 0 ? await this.claimJobs(capacity) : [];
      if (jobs.length > 0) {
        setImmediate(() => this.executeJobs(jobs));
      }
      return {
        accepted: true,
        enqueued,
        claimed: jobs.length,
        activeJobs: this.activeJobs.size,
        recovered,
      };
    } finally {
      this.dispatching = false;
    }
  }

  async status() {
    const [byStatus, latestJobs, oldQueued] = await Promise.all([
      this.prisma.monitoringJob.groupBy({ by: ['status'], _count: true }),
      this.prisma.monitoringJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          type: true,
          status: true,
          attempts: true,
          maxAttempts: true,
          scheduledFor: true,
          startedAt: true,
          completedAt: true,
          lastError: true,
          createdAt: true,
        },
      }),
      this.prisma.monitoringJob.count({
        where: {
          status: JobStatus.QUEUED,
          scheduledFor: { lt: new Date(Date.now() - 5 * 60_000) },
        },
      }),
    ]);
    return {
      workerId: this.workerId,
      workerRegion: this.workerRegion,
      concurrency: this.concurrency,
      activeJobs: this.activeJobs.size,
      jobs: byStatus,
      overdueQueued: oldQueued,
      latestJobs,
      localScheduler: this.config.get('ALLOW_LOCAL_SCHEDULER') === 'true',
    };
  }

  private async recoverStaleJobs(): Promise<number> {
    const cutoff = new Date(Date.now() - this.lockTimeoutSeconds * 1000);
    const stale = await this.prisma.monitoringJob.findMany({
      where: {
        status: JobStatus.RUNNING,
        lockedAt: { lt: cutoff },
        ...(this.workerRegion ? { region: this.workerRegion } : { region: null }),
      },
      select: { id: true, attempts: true, maxAttempts: true },
      take: 100,
    });
    let recovered = 0;
    for (const job of stale) {
      const finalFailure = job.attempts >= job.maxAttempts;
      const result = await this.prisma.monitoringJob.updateMany({
        where: {
          id: job.id,
          status: JobStatus.RUNNING,
          lockedAt: { lt: cutoff },
        },
        data: finalFailure
          ? {
              status: JobStatus.FAILED,
              lockedAt: null,
              lockedBy: null,
              completedAt: new Date(),
              lastError: 'Worker lock expired after maximum attempts',
            }
          : {
              status: JobStatus.QUEUED,
              lockedAt: null,
              lockedBy: null,
              scheduledFor: new Date(
                Date.now() + Math.min(300_000, Math.pow(2, Math.max(1, job.attempts)) * 15_000),
              ),
              lastError: 'Worker lock expired; task requeued',
            },
      });
      recovered += result.count;
    }
    if (recovered > 0) this.logger.warn(`Recovered ${recovered} stale monitoring job(s)`);
    return recovered;
  }

  private async enqueueDueWork(): Promise<EnqueueCounts> {
    const counts = this.emptyEnqueueCounts();
    const now = new Date();

    counts.monitors = await this.enqueueDueMonitors(now);
    counts.heartbeats = await this.enqueueDueHeartbeats(now);
    counts.metrics = await this.enqueueDueMetrics(now);
    counts.reports = await this.enqueueDueReports(now);
    counts.notificationRetries = await this.enqueueNotificationRetry(now);
    counts.retention = await this.enqueueRetention(now);
    return counts;
  }

  private async enqueueDueMonitors(now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<
        Array<{
          id: string;
          nextRunAt: Date | null;
          intervalSeconds: number;
          egressMode: string;
          region: string | null;
        }>
      >(Prisma.sql`
        SELECT id, "nextRunAt", "intervalSeconds", "egressMode", region
        FROM "Monitor"
        WHERE active = true
          AND ("nextRunAt" IS NULL OR "nextRunAt" <= NOW())
        ORDER BY "nextRunAt" NULLS FIRST
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      `);
      let created = 0;
      for (const monitor of due) {
        const dueToken = (monitor.nextRunAt ?? now).toISOString();
        const nextRun = new Date(
          now.getTime() + Math.max(60, monitor.intervalSeconds) * 1000,
        );
        await tx.monitor.update({
          where: { id: monitor.id },
          data: { nextRunAt: nextRun },
        });
        const result = await tx.monitoringJob.createMany({
          data: [
            {
              type: 'HEALTH_CHECK',
              status: 'QUEUED',
              dedupeKey: `health:${monitor.id}:${dueToken}`,
              monitorId: monitor.id,
              region: monitor.egressMode === 'REGION' ? monitor.region : null,
              scheduledFor: now,
              maxAttempts: this.defaultMaxAttempts,
            },
          ],
          skipDuplicates: true,
        });
        created += result.count;
      }
      return created;
    });
  }

  private async enqueueDueHeartbeats(now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<
        Array<{ id: string; heartbeatNextRunAt: Date | null; heartbeatIntervalMinutes: number }>
      >(Prisma.sql`
        SELECT id, "heartbeatNextRunAt", "heartbeatIntervalMinutes"
        FROM "Integration"
        WHERE type = 'SUPABASE'
          AND "heartbeatEnabled" = true
          AND ("heartbeatNextRunAt" IS NULL OR "heartbeatNextRunAt" <= NOW())
        ORDER BY "heartbeatNextRunAt" NULLS FIRST
        LIMIT 50
        FOR UPDATE SKIP LOCKED
      `);
      let created = 0;
      for (const integration of due) {
        const dueToken = (integration.heartbeatNextRunAt ?? now).toISOString();
        await tx.integration.update({
          where: { id: integration.id },
          data: {
            heartbeatNextRunAt: new Date(
              now.getTime() + Math.max(5, integration.heartbeatIntervalMinutes) * 60_000,
            ),
          },
        });
        const result = await tx.monitoringJob.createMany({
          data: [
            {
              type: 'HEARTBEAT',
              status: 'QUEUED',
              dedupeKey: `heartbeat:${integration.id}:${dueToken}`,
              integrationId: integration.id,
              scheduledFor: now,
              maxAttempts: this.defaultMaxAttempts,
            },
          ],
          skipDuplicates: true,
        });
        created += result.count;
      }
      return created;
    });
  }

  private async enqueueDueMetrics(now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<
        Array<{ id: string; metricsNextRunAt: Date | null; metricsIntervalMinutes: number }>
      >(Prisma.sql`
        SELECT id, "metricsNextRunAt", "metricsIntervalMinutes"
        FROM "Integration"
        WHERE "metricsEnabled" = true
          AND ("metricsNextRunAt" IS NULL OR "metricsNextRunAt" <= NOW())
        ORDER BY "metricsNextRunAt" NULLS FIRST
        LIMIT 50
        FOR UPDATE SKIP LOCKED
      `);
      let created = 0;
      for (const integration of due) {
        const dueToken = (integration.metricsNextRunAt ?? now).toISOString();
        await tx.integration.update({
          where: { id: integration.id },
          data: {
            metricsNextRunAt: new Date(
              now.getTime() + Math.max(5, integration.metricsIntervalMinutes) * 60_000,
            ),
          },
        });
        const result = await tx.monitoringJob.createMany({
          data: [
            {
              type: 'DATABASE_METRICS',
              status: 'QUEUED',
              dedupeKey: `metrics:${integration.id}:${dueToken}`,
              integrationId: integration.id,
              scheduledFor: now,
              maxAttempts: this.defaultMaxAttempts,
            },
          ],
          skipDuplicates: true,
        });
        created += result.count;
      }
      return created;
    });
  }

  private async enqueueDueReports(now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<
        Array<{
          id: string;
          nextRunAt: Date;
          frequency: ReportFrequency;
          name: string;
        }>
      >(Prisma.sql`
        SELECT id, "nextRunAt", frequency, name
        FROM "ReportSchedule"
        WHERE enabled = true AND "nextRunAt" <= NOW()
        ORDER BY "nextRunAt"
        LIMIT 25
        FOR UPDATE SKIP LOCKED
      `);
      let created = 0;
      for (const schedule of due) {
        const dueDate = schedule.nextRunAt;
        const nextRunAt = this.nextReportTime(schedule.frequency, now);
        await tx.reportSchedule.update({
          where: { id: schedule.id },
          data: { nextRunAt },
        });
        const result = await tx.monitoringJob.createMany({
          data: [
            {
              type: 'REPORT_GENERATION',
              status: 'QUEUED',
              dedupeKey: `report:${schedule.id}:${dueDate.toISOString()}`,
              reportScheduleId: schedule.id,
              scheduledFor: dueDate,
              maxAttempts: 2,
            },
          ],
          skipDuplicates: true,
        });
        created += result.count;
      }
      return created;
    });
  }

  private async enqueueNotificationRetry(now: Date): Promise<number> {
    const minuteKey = now.toISOString().slice(0, 16);
    const result = await this.prisma.monitoringJob.createMany({
      data: [
        {
          type: 'NOTIFICATION_RETRY',
          status: 'QUEUED',
          dedupeKey: `notifications:${minuteKey}`,
          scheduledFor: now,
          maxAttempts: 3,
        },
      ],
      skipDuplicates: true,
    });
    return result.count;
  }

  private async enqueueRetention(now: Date): Promise<number> {
    const dayKey = now.toISOString().slice(0, 10);
    const result = await this.prisma.monitoringJob.createMany({
      data: [
        {
          type: 'RETENTION_CLEANUP',
          status: 'QUEUED',
          dedupeKey: `retention:${dayKey}`,
          scheduledFor: now,
          maxAttempts: 2,
        },
      ],
      skipDuplicates: true,
    });
    return result.count;
  }

  private async claimJobs(limit: number): Promise<ClaimedJob[]> {
    if (limit <= 0) return [];
    try {
      const regionFilter = this.workerRegion
        ? Prisma.sql`AND region = ${this.workerRegion}`
        : Prisma.sql`AND region IS NULL`;
      const jobs = await this.prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
        WITH picked AS (
          SELECT id
          FROM "MonitoringJob"
          WHERE status = 'QUEUED'::"JobStatus"
            AND "scheduledFor" <= NOW()
            ${regionFilter}
          ORDER BY "scheduledFor" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "MonitoringJob" AS j
        SET status = 'RUNNING'::"JobStatus",
            "lockedAt" = NOW(),
            "lockedBy" = ${this.workerId},
            "startedAt" = COALESCE(j."startedAt", NOW()),
            attempts = j.attempts + 1,
            "updatedAt" = NOW()
        FROM picked
        WHERE j.id = picked.id
        RETURNING j.id, j.type, j."monitorId", j."integrationId", j."reportId",
                  j."reportScheduleId", j.region, j."scheduledFor", j.attempts, j."maxAttempts"
      `);
      return jobs;
    } catch (error) {
      this.logger.error(`Job claim failed: ${(error as Error).message}`);
      return [];
    }
  }

  private executeJobs(jobs: ClaimedJob[]): void {
    for (const job of jobs) {
      this.activeJobs.add(job.id);
      void this.executeJob(job)
        .catch((error) => {
          this.logger.error(`Unhandled job error ${job.id}: ${(error as Error).message}`);
        })
        .finally(() => this.activeJobs.delete(job.id));
    }
  }

  private async executeJob(job: ClaimedJob): Promise<void> {
    const lockRefresh = setInterval(() => {
      void this.prisma.monitoringJob
        .updateMany({
          where: { id: job.id, status: JobStatus.RUNNING, lockedBy: this.workerId },
          data: { lockedAt: new Date() },
        })
        .catch(() => undefined);
    }, 30_000);
    lockRefresh.unref?.();
    try {
      const result = await this.withTimeout(this.runJob(job), this.timeoutFor(job.type));
      const updated = await this.prisma.monitoringJob.updateMany({
        where: { id: job.id, status: JobStatus.RUNNING, lockedBy: this.workerId },
        data: {
          status: JobStatus.SUCCEEDED,
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          result: this.safeResult(result) as Prisma.InputJsonValue,
        },
      });
      if (updated.count === 0) {
        this.logger.warn(`Job ${job.id} lost its lease before completion`);
      }
    } catch (error) {
      const message = redactSecrets((error as Error).message, 1000) ?? 'Job failed';
      const finalFailure = job.attempts >= job.maxAttempts;
      const backoffSeconds = Math.min(600, Math.pow(2, Math.max(1, job.attempts)) * 30);
      await this.prisma.monitoringJob.updateMany({
        where: { id: job.id, status: JobStatus.RUNNING, lockedBy: this.workerId },
        data: finalFailure
          ? {
              status: JobStatus.FAILED,
              completedAt: new Date(),
              lockedAt: null,
              lockedBy: null,
              lastError: message,
            }
          : {
              status: JobStatus.QUEUED,
              lockedAt: null,
              lockedBy: null,
              scheduledFor: new Date(Date.now() + backoffSeconds * 1000),
              lastError: message,
            },
      });
      this.logger.warn(
        `Job ${job.id} (${job.type}) failed attempt ${job.attempts}/${job.maxAttempts}: ${message}`,
      );
    } finally {
      clearInterval(lockRefresh);
    }
  }

  private async runJob(job: ClaimedJob): Promise<unknown> {
    switch (job.type) {
      case 'HEALTH_CHECK':
        if (!job.monitorId) throw new Error('Health job has no monitor target');
        return this.health.execute(job.monitorId, {
          scheduled: true,
          jobId: job.id,
          region: job.region,
        });
      case 'HEARTBEAT':
        if (!job.integrationId) throw new Error('Heartbeat job has no integration target');
        return this.heartbeat.executeScheduled(job.integrationId, job.id);
      case 'DATABASE_METRICS':
        if (!job.integrationId) throw new Error('Metrics job has no integration target');
        return this.databaseMetrics.executeScheduled(job.integrationId, job.id);
      case 'REPORT_GENERATION':
        if (!job.reportScheduleId) throw new Error('Report job has no schedule target');
        return this.reports.generateFromSchedule(job.reportScheduleId, job.id, job.scheduledFor);
      case 'NOTIFICATION_RETRY':
        return this.notifications.retryPending();
      case 'RETENTION_CLEANUP':
        return this.retention.cleanupAll();
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  private timeoutFor(type: string): number {
    switch (type) {
      case 'HEALTH_CHECK':
        return 45_000;
      case 'HEARTBEAT':
        return 30_000;
      case 'DATABASE_METRICS':
        return 40_000;
      case 'REPORT_GENERATION':
        return 300_000;
      case 'RETENTION_CLEANUP':
        return 240_000;
      default:
        return 60_000;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private safeResult(result: unknown): Record<string, unknown> {
    if (!result || typeof result !== 'object') return { ok: true };
    const source = result as Record<string, unknown>;
    const allowed = [
      'id',
      'status',
      'skipped',
      'reason',
      'processed',
      'sent',
      'teams',
      'deleted',
      'connectivity',
      'accepted',
      'error',
      'executedAt',
    ];
    const safe: Record<string, unknown> = {};
    for (const key of allowed) {
      if (source[key] !== undefined) safe[key] = source[key];
    }
    if (Object.keys(safe).length === 0) return { ok: true };
    return safe;
  }

  private nextReportTime(frequency: ReportFrequency, after: Date): Date {
    const next = new Date(after);
    next.setUTCHours(8, 0, 0, 0);
    if (frequency === ReportFrequency.DAILY) {
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    }
    if (frequency === ReportFrequency.WEEKLY) {
      next.setUTCDate(next.getUTCDate() + (((8 - next.getUTCDay()) % 7) || 7));
      return next;
    }
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  private emptyEnqueueCounts(): EnqueueCounts {
    return {
      monitors: 0,
      heartbeats: 0,
      metrics: 0,
      reports: 0,
      notificationRetries: 0,
      retention: 0,
    };
  }
}
