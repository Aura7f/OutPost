import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const BATCH_SIZE = 2000;
const MAX_BATCHES_PER_TABLE = 20;

/**
 * Team-configurable monitoring history retention. Incidents, reports, and
 * resolved error groups are preserved; high-volume check/metric/event history
 * is deleted in bounded batches to avoid long table locks.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async cleanupAll(): Promise<{ teams: number; deleted: Record<string, number> }> {
    const teams = await this.prisma.team.findMany({
      select: { id: true, retentionDays: true },
    });
    const deleted: Record<string, number> = {
      monitorRuns: 0,
      heartbeatRuns: 0,
      databaseMetrics: 0,
      errorEvents: 0,
      notificationDeliveries: 0,
      monitoringJobs: 0,
      auditLogs: 0,
    };
    for (const team of teams) {
      const cutoff = new Date(Date.now() - team.retentionDays * 24 * 60 * 60 * 1000);
      deleted.monitorRuns += await this.deleteBatched(
        () =>
          this.prisma.monitorRun.findMany({
            where: { monitor: { project: { teamId: team.id } }, checkedAt: { lt: cutoff } },
            select: { id: true },
            take: BATCH_SIZE,
          }),
        (ids) => this.prisma.monitorRun.deleteMany({ where: { id: { in: ids } } }),
      );
      deleted.heartbeatRuns += await this.deleteBatched(
        () =>
          this.prisma.heartbeatRun.findMany({
            where: { integration: { project: { teamId: team.id } }, executedAt: { lt: cutoff } },
            select: { id: true },
            take: BATCH_SIZE,
          }),
        (ids) => this.prisma.heartbeatRun.deleteMany({ where: { id: { in: ids } } }),
      );
      deleted.databaseMetrics += await this.deleteBatched(
        () =>
          this.prisma.databaseMetric.findMany({
            where: { integration: { project: { teamId: team.id } }, collectedAt: { lt: cutoff } },
            select: { id: true },
            take: BATCH_SIZE,
          }),
        (ids) => this.prisma.databaseMetric.deleteMany({ where: { id: { in: ids } } }),
      );
      deleted.errorEvents += await this.deleteBatched(
        () =>
          this.prisma.errorEvent.findMany({
            where: { project: { teamId: team.id }, timestamp: { lt: cutoff } },
            select: { id: true },
            take: BATCH_SIZE,
          }),
        (ids) => this.prisma.errorEvent.deleteMany({ where: { id: { in: ids } } }),
      );
      deleted.notificationDeliveries += await this.deleteBatched(
        () =>
          this.prisma.notificationDelivery.findMany({
            where: {
              teamId: team.id,
              createdAt: { lt: cutoff },
              status: { in: ['SENT', 'FAILED'] },
            },
            select: { id: true },
            take: BATCH_SIZE,
          }),
        (ids) => this.prisma.notificationDelivery.deleteMany({ where: { id: { in: ids } } }),
      );
      deleted.auditLogs += await this.deleteBatched(
        () =>
          this.prisma.auditLog.findMany({
            where: { teamId: team.id, createdAt: { lt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) } },
            select: { id: true },
            take: BATCH_SIZE,
          }),
        (ids) => this.prisma.auditLog.deleteMany({ where: { id: { in: ids } } }),
      );
    }

    // Operational job rows are not team-owned. Keep two weeks for debugging.
    const jobCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    deleted.monitoringJobs = await this.deleteBatched(
      () =>
        this.prisma.monitoringJob.findMany({
          where: {
            createdAt: { lt: jobCutoff },
            status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] },
          },
          select: { id: true },
          take: BATCH_SIZE,
        }),
      (ids) => this.prisma.monitoringJob.deleteMany({ where: { id: { in: ids } } }),
    );

    this.logger.log(`Retention cleanup removed ${JSON.stringify(deleted)}`);
    return { teams: teams.length, deleted };
  }

  private async deleteBatched(
    findBatch: () => Promise<Array<{ id: string }>>,
    remove: (ids: string[]) => Promise<{ count: number }>,
  ): Promise<number> {
    let total = 0;
    for (let index = 0; index < MAX_BATCHES_PER_TABLE; index += 1) {
      const rows = await findBatch();
      if (rows.length === 0) break;
      const result = await remove(rows.map((row) => row.id));
      total += result.count;
      if (rows.length < BATCH_SIZE) break;
    }
    return total;
  }
}
