import type { ConfigService } from '@nestjs/config';
import { JobStatus, ReportFrequency } from '@prisma/client';
import { SchedulerService } from './scheduler.service';

function createService() {
  const values: Record<string, unknown> = {
    MONITORING_CONCURRENCY: 5,
    JOB_LOCK_TIMEOUT_SECONDS: 120,
    JOB_MAX_ATTEMPTS: 3,
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
  const prisma = {
    monitoringJob: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: jest.fn(),
  };
  const service = new SchedulerService(
    prisma as never,
    config,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, serviceAny: service as unknown as Record<string, any>, prisma, config };
}

describe('SchedulerService', () => {
  it('runs one dispatch pass under the configured concurrency', async () => {
    const { service, serviceAny } = createService();
    serviceAny.recoverStaleJobs = jest.fn().mockResolvedValue(2);
    serviceAny.enqueueDueWork = jest.fn().mockResolvedValue({
      monitors: 1,
      heartbeats: 2,
      metrics: 3,
      reports: 4,
      notificationRetries: 1,
      retention: 1,
    });
    serviceAny.claimJobs = jest.fn().mockResolvedValue([]);

    await expect(service.dispatch()).resolves.toEqual({
      accepted: true,
      enqueued: {
        monitors: 1,
        heartbeats: 2,
        metrics: 3,
        reports: 4,
        notificationRetries: 1,
        retention: 1,
      },
      claimed: 0,
      activeJobs: 0,
      recovered: 2,
    });
    expect(serviceAny.claimJobs).toHaveBeenCalledWith(5);
    expect(serviceAny.dispatching).toBe(false);
  });

  it('refuses overlapping dispatch passes', async () => {
    const { service, serviceAny } = createService();
    serviceAny.dispatching = true;
    const enqueue = jest.fn();
    serviceAny.enqueueDueWork = enqueue;

    const result = await service.dispatch();

    expect(result.accepted).toBe(true);
    expect(result.claimed).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('requeues expired leases and fails jobs that exhausted attempts', async () => {
    const { serviceAny, prisma } = createService();
    prisma.monitoringJob.findMany.mockResolvedValue([
      { id: 'job-1', attempts: 1, maxAttempts: 3 },
      { id: 'job-2', attempts: 3, maxAttempts: 3 },
    ]);

    await expect(serviceAny.recoverStaleJobs()).resolves.toBe(2);

    const payloads = prisma.monitoringJob.updateMany.mock.calls.map((call: unknown[]) => call[0]);
    expect(payloads[0]).toMatchObject({
      where: { id: 'job-1', status: JobStatus.RUNNING },
      data: { status: JobStatus.QUEUED, lockedAt: null, lastError: expect.stringContaining('requeued') },
    });
    expect(payloads[1]).toMatchObject({
      where: { id: 'job-2', status: JobStatus.RUNNING },
      data: { status: JobStatus.FAILED, lastError: expect.stringContaining('maximum attempts') },
    });
  });

  it('does not surface partial claims when the database query fails', async () => {
    const { serviceAny, prisma } = createService();
    prisma.$queryRaw.mockRejectedValue(new Error('connection reset'));

    await expect(serviceAny.claimJobs(5)).resolves.toEqual([]);
  });

  it('uses minute and day dedupe buckets for background jobs', async () => {
    const { serviceAny, prisma } = createService();
    const now = new Date('2026-10-19T10:42:33.000Z');

    await serviceAny.enqueueNotificationRetry(now);
    await serviceAny.enqueueRetention(now);

    const payloads = prisma.monitoringJob.createMany.mock.calls.map(
      (call: unknown[]) => call[0] as any,
    );
    expect(payloads[0].data[0].dedupeKey).toBe('notifications:2026-10-19T10:42');
    expect(payloads[1].data[0].dedupeKey).toBe('retention:2026-10-19');
    expect(payloads[0].skipDuplicates).toBe(true);
    expect(payloads[1].skipDuplicates).toBe(true);
  });

  it('computes daily, weekly, and monthly report run times at 08:00 UTC', () => {
    const { serviceAny } = createService();
    const monday = new Date('2026-10-19T10:30:00.000Z');

    expect(serviceAny.nextReportTime(ReportFrequency.DAILY, monday).toISOString()).toBe(
      '2026-10-20T08:00:00.000Z',
    );
    expect(serviceAny.nextReportTime(ReportFrequency.WEEKLY, monday).toISOString()).toBe(
      '2026-10-26T08:00:00.000Z',
    );
    expect(serviceAny.nextReportTime(ReportFrequency.MONTHLY, monday).toISOString()).toBe(
      '2026-11-01T08:00:00.000Z',
    );
  });

  it('marks successful jobs complete and redacts failed job errors', async () => {
    const { serviceAny, prisma } = createService();
    serviceAny.runJob = jest.fn().mockResolvedValue({ id: 'run-1', status: 'UP' });
    serviceAny.withTimeout = jest.fn((promise: Promise<unknown>) => promise);

    const baseJob = {
      id: 'job-1',
      type: 'HEALTH_CHECK',
      monitorId: 'monitor-1',
      integrationId: null,
      reportId: null,
      reportScheduleId: null,
      scheduledFor: new Date(),
      attempts: 1,
      maxAttempts: 3,
    };

    await serviceAny.executeJob(baseJob);
    expect(prisma.monitoringJob.updateMany.mock.calls[0][0]).toMatchObject({
      data: { status: JobStatus.SUCCEEDED, result: { id: 'run-1', status: 'UP' } },
    });

    serviceAny.runJob = jest.fn().mockRejectedValue(new Error('authorization: Bearer leaked-token'));
    await serviceAny.executeJob(baseJob);
    const retry = prisma.monitoringJob.updateMany.mock.calls[1][0];
    expect(retry.data).toMatchObject({ status: JobStatus.QUEUED });
    expect(retry.data.lastError).toContain('[REDACTED]');
    expect(retry.data.lastError).not.toContain('leaked-token');

    serviceAny.runJob = jest.fn().mockRejectedValue(new Error('permanent failure'));
    await serviceAny.executeJob({ ...baseJob, attempts: 3 });
    expect(prisma.monitoringJob.updateMany.mock.calls[2][0].data).toMatchObject({
      status: JobStatus.FAILED,
      completedAt: expect.any(Date),
    });
  });
});
