import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MonitorHealth, MonitorMethod, EgressMode } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ProjectsService } from '../../projects/projects.service';
import { SsrfGuard } from './ssrf-guard';
import { EgressService } from './egress.service';
import { HealthCheckExecutor } from './health-check.executor';
import { pagination, parseDate, percent, timeBucket } from '../../common/utils';
import type { AuthenticatedUser, TeamContext } from '../../common/types';
import type {
  CreateMonitorDto,
  HealthRunsQueryDto,
  MonitorRunQueryDto,
  MonitorStatsQueryDto,
  UpdateMonitorDto,
} from './monitors.dto';

@Injectable()
export class MonitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly ssrf: SsrfGuard,
    private readonly egress: EgressService,
    private readonly executor: HealthCheckExecutor,
    private readonly audit: AuditService,
  ) {}

  egressOptions() {
    return {
      default: true,
      proxy: { enabled: this.egress.hasProxies(), count: this.egress.proxyCount() },
      regions: this.egress.regionList(),
    };
  }

  async list(team: TeamContext, projectId: string) {
    await this.projects.requireProject(team, projectId);
    return this.prisma.monitor.findMany({
      where: { projectId },
      include: {
        service: { select: { id: true, name: true } },
        _count: { select: { runs: true } },
        incidents: {
          where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
          select: { id: true, title: true, severity: true, startedAt: true },
          take: 1,
          orderBy: { startedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(team: TeamContext, monitorId: string) {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, project: { teamId: team.teamId } },
      include: {
        project: { select: { id: true, name: true, environment: true } },
        service: { select: { id: true, name: true } },
        runs: { orderBy: { checkedAt: 'desc' }, take: 10 },
      },
    });
    if (!monitor) throw new NotFoundException('Monitor not found');
    return monitor;
  }

  async create(user: AuthenticatedUser, team: TeamContext, projectId: string, dto: CreateMonitorDto) {
    await this.projects.requireProject(team, projectId);
    this.ssrf.validateUrlSyntax(dto.url);
    if (dto.serviceId) await this.assertService(projectId, dto.serviceId);

    const expectedStatusCodes = [...new Set(dto.expectedStatusCodes ?? [200])];
    if (!expectedStatusCodes.length) throw new BadRequestException('At least one expected status code is required');
    const intervalSeconds = dto.intervalSeconds ?? 300;
    const active = dto.active ?? true;
    const egress = this.egress.assertChoice(dto.egressMode ?? EgressMode.DEFAULT, dto.region);
    const monitor = await this.prisma.monitor.create({
      data: {
        projectId,
        serviceId: dto.serviceId || null,
        name: dto.name.trim(),
        url: dto.url,
        method: dto.method ?? MonitorMethod.GET,
        expectedStatusCodes,
        timeoutMs: dto.timeoutMs ?? 10_000,
        intervalSeconds,
        active,
        egressMode: egress.mode,
        region: egress.region,
        failureThreshold: dto.failureThreshold ?? 3,
        lastStatus: MonitorHealth.UNKNOWN,
        nextRunAt: active ? new Date(Date.now() + intervalSeconds * 1000) : null,
      },
      include: { service: { select: { id: true, name: true } } },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId,
      action: 'monitor.created',
      resourceType: 'Monitor',
      resourceId: monitor.id,
      metadata: { name: monitor.name, method: monitor.method, intervalSeconds },
    });
    return monitor;
  }

  async update(user: AuthenticatedUser, team: TeamContext, monitorId: string, dto: UpdateMonitorDto) {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, project: { teamId: team.teamId } },
    });
    if (!monitor) throw new NotFoundException('Monitor not found');
    if (dto.url) this.ssrf.validateUrlSyntax(dto.url);
    if (dto.serviceId) await this.assertService(monitor.projectId, dto.serviceId);

    const active = dto.active ?? monitor.active;
    const intervalSeconds = dto.intervalSeconds ?? monitor.intervalSeconds;
    const egress = this.egress.assertChoice(
      dto.egressMode ?? monitor.egressMode,
      dto.region !== undefined ? dto.region : monitor.region,
    );
    const updated = await this.prisma.monitor.update({
      where: { id: monitor.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.method !== undefined ? { method: dto.method } : {}),
        ...(dto.expectedStatusCodes !== undefined
          ? { expectedStatusCodes: [...new Set(dto.expectedStatusCodes)] }
          : {}),
        ...(dto.timeoutMs !== undefined ? { timeoutMs: dto.timeoutMs } : {}),
        ...(dto.intervalSeconds !== undefined ? { intervalSeconds: dto.intervalSeconds } : {}),
        ...(dto.failureThreshold !== undefined ? { failureThreshold: dto.failureThreshold } : {}),
        ...(dto.serviceId !== undefined ? { serviceId: dto.serviceId || null } : {}),
        egressMode: egress.mode,
        region: egress.region,
        active,
        nextRunAt: active ? new Date(Date.now() + intervalSeconds * 1000) : null,
      },
      include: { service: { select: { id: true, name: true } } },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: monitor.projectId,
      action: 'monitor.updated',
      resourceType: 'Monitor',
      resourceId: monitor.id,
      metadata: { fields: Object.keys(dto), active },
    });
    return updated;
  }

  async delete(user: AuthenticatedUser, team: TeamContext, monitorId: string) {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, project: { teamId: team.teamId } },
      select: { id: true, projectId: true, name: true },
    });
    if (!monitor) throw new NotFoundException('Monitor not found');
    await this.prisma.monitor.delete({ where: { id: monitor.id } });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: monitor.projectId,
      action: 'monitor.deleted',
      resourceType: 'Monitor',
      resourceId: monitor.id,
      metadata: { name: monitor.name },
    });
    return { deleted: true };
  }

  async run(user: AuthenticatedUser, team: TeamContext, monitorId: string) {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, project: { teamId: team.teamId } },
      select: { id: true, projectId: true, egressMode: true, region: true },
    });
    if (!monitor) throw new NotFoundException('Monitor not found');

    if (monitor.egressMode === EgressMode.REGION) {
      const job = await this.prisma.monitoringJob.create({
        data: {
          type: 'HEALTH_CHECK',
          status: 'QUEUED',
          dedupeKey: `health-manual:${monitor.id}:${randomUUID()}`,
          monitorId: monitor.id,
          region: monitor.region,
          scheduledFor: new Date(),
          maxAttempts: 2,
        },
        select: { id: true },
      });
      await this.audit.log({
        teamId: team.teamId,
        actorId: user.profileId,
        projectId: monitor.projectId,
        action: 'monitor.manual_check',
        resourceType: 'Monitor',
        resourceId: monitor.id,
        metadata: { jobId: job.id, region: monitor.region },
      });
      return { queued: true, jobId: job.id, region: monitor.region };
    }

    const run = await this.executor.execute(monitor.id);
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: monitor.projectId,
      action: 'monitor.manual_check',
      resourceType: 'Monitor',
      resourceId: monitor.id,
      metadata: { runId: 'id' in run ? run.id : undefined },
    });
    return run;
  }

  async runs(team: TeamContext, monitorId: string, query: MonitorRunQueryDto) {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, project: { teamId: team.teamId } },
      select: { id: true, name: true, url: true },
    });
    if (!monitor) throw new NotFoundException('Monitor not found');
    const { skip, take, page, pageSize } = pagination(query.page, query.pageSize);
    const where = {
      monitorId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            checkedAt: {
              ...(query.from ? { gte: parseDate(query.from, new Date(0)) } : {}),
              ...(query.to ? { lte: parseDate(query.to, new Date()) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.monitorRun.findMany({ where, orderBy: { checkedAt: 'desc' }, skip, take }),
      this.prisma.monitorRun.count({ where }),
    ]);
    return { monitor, items, total, page, pageSize };
  }

  async stats(team: TeamContext, monitorId: string, query: MonitorStatsQueryDto) {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, project: { teamId: team.teamId } },
      select: { id: true, name: true, intervalSeconds: true, lastStatus: true },
    });
    if (!monitor) throw new NotFoundException('Monitor not found');
    return this.buildStats(monitor.id, query.range ?? '24h');
  }

  async history(team: TeamContext, query: HealthRunsQueryDto) {
    if (query.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: query.projectId, teamId: team.teamId },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('Project not found');
    }
    if (query.monitorId) {
      const monitor = await this.prisma.monitor.findFirst({
        where: { id: query.monitorId, project: { teamId: team.teamId } },
        select: { id: true },
      });
      if (!monitor) throw new NotFoundException('Monitor not found');
    }
    const { skip, take, page, pageSize } = pagination(query.page, query.pageSize);
    const where = {
      monitor: {
        project: {
          teamId: team.teamId,
          ...(query.projectId ? { id: query.projectId } : {}),
        },
        ...(query.monitorId ? { id: query.monitorId } : {}),
      },
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            checkedAt: {
              ...(query.from ? { gte: parseDate(query.from, new Date(0)) } : {}),
              ...(query.to ? { lte: parseDate(query.to, new Date()) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.monitorRun.findMany({
        where,
        orderBy: { checkedAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          status: true,
          statusCode: true,
          latencyMs: true,
          error: true,
          checkedAt: true,
          monitor: {
            select: {
              id: true,
              name: true,
              url: true,
              project: { select: { id: true, name: true, environment: true } },
            },
          },
        },
      }),
      this.prisma.monitorRun.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async overview(team: TeamContext, projectId?: string) {
    if (projectId) await this.projects.requireProject(team, projectId);
    const monitors = await this.prisma.monitor.findMany({
      where: {
        project: { teamId: team.teamId },
        ...(projectId ? { projectId } : {}),
      },
      include: {
        project: { select: { id: true, name: true, environment: true } },
        service: { select: { id: true, name: true } },
      },
      orderBy: [{ lastStatus: 'desc' }, { name: 'asc' }],
    });
    const monitorIds = monitors.map((m) => m.id);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const runs = monitorIds.length
      ? await this.prisma.monitorRun.findMany({
          where: { monitorId: { in: monitorIds }, checkedAt: { gte: since } },
          select: { monitorId: true, status: true, latencyMs: true, checkedAt: true, error: true },
          orderBy: { checkedAt: 'asc' },
          take: 20_000,
        })
      : [];
    const openIncidents = monitorIds.length
      ? await this.prisma.incident.findMany({
          where: {
            monitorId: { in: monitorIds },
            status: { in: ['OPEN', 'ACKNOWLEDGED'] },
          },
          select: { id: true, monitorId: true, title: true, severity: true, status: true, startedAt: true },
        })
      : [];

    const byMonitor = new Map<string, typeof runs>();
    for (const run of runs) {
      const list = byMonitor.get(run.monitorId) ?? [];
      list.push(run);
      byMonitor.set(run.monitorId, list);
    }
    const enriched = monitors.map((monitor) => {
      const monitorRuns = byMonitor.get(monitor.id) ?? [];
      const successes = monitorRuns.filter((run) => run.status === 'SUCCESS');
      const latencies = successes
        .map((run) => run.latencyMs)
        .filter((value): value is number => value !== null);
      return {
        ...monitor,
        uptime24h: percent(successes.length, monitorRuns.length),
        avgLatency24h: latencies.length
          ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
          : null,
        checks24h: monitorRuns.length,
        openIncident: openIncidents.find((incident) => incident.monitorId === monitor.id) ?? null,
      };
    });

    const bucketMinutes = 30;
    const timeline = new Map<string, { total: number; success: number; latency: number; latencyCount: number }>();
    for (const run of runs) {
      const key = timeBucket(run.checkedAt, bucketMinutes);
      const bucket = timeline.get(key) ?? { total: 0, success: 0, latency: 0, latencyCount: 0 };
      bucket.total += 1;
      if (run.status === 'SUCCESS') {
        bucket.success += 1;
        if (run.latencyMs !== null) {
          bucket.latency += run.latencyMs;
          bucket.latencyCount += 1;
        }
      }
      timeline.set(key, bucket);
    }
    const totalRuns = runs.length;
    const successRuns = runs.filter((run) => run.status === 'SUCCESS').length;
    const allLatencies = runs
      .filter((run) => run.status === 'SUCCESS' && run.latencyMs !== null)
      .map((run) => run.latencyMs as number);

    return {
      summary: {
        total: monitors.length,
        up: monitors.filter((monitor) => monitor.lastStatus === 'UP').length,
        down: monitors.filter((monitor) => monitor.lastStatus === 'DOWN').length,
        unknown: monitors.filter((monitor) => monitor.lastStatus === 'UNKNOWN').length,
        uptime24h: percent(successRuns, totalRuns),
        avgLatency24h: allLatencies.length
          ? Math.round(allLatencies.reduce((sum, value) => sum + value, 0) / allLatencies.length)
          : null,
        openIncidents: openIncidents.length,
        checks24h: totalRuns,
      },
      monitors: enriched,
      recentFailures: runs
        .filter((run) => run.status !== 'SUCCESS')
        .slice(-8)
        .reverse()
        .map((run) => ({
          ...run,
          monitor: monitors.find((monitor) => monitor.id === run.monitorId),
        })),
      timeline: [...timeline.entries()].map(([timestamp, bucket]) => ({
        timestamp,
        uptime: percent(bucket.success, bucket.total),
        latencyMs: bucket.latencyCount ? Math.round(bucket.latency / bucket.latencyCount) : null,
        checks: bucket.total,
      })),
      incidents: openIncidents,
    };
  }

  private async buildStats(monitorId: string, range: '24h' | '7d' | '30d' | '90d') {
    const config = {
      '24h': { ms: 24 * 60 * 60 * 1000, bucket: 30 },
      '7d': { ms: 7 * 24 * 60 * 60 * 1000, bucket: 360 },
      '30d': { ms: 30 * 24 * 60 * 60 * 1000, bucket: 1440 },
      '90d': { ms: 90 * 24 * 60 * 60 * 1000, bucket: 1440 },
    }[range];
    const since = new Date(Date.now() - config.ms);
    const runs = await this.prisma.monitorRun.findMany({
      where: { monitorId, checkedAt: { gte: since } },
      select: { status: true, latencyMs: true, checkedAt: true },
      orderBy: { checkedAt: 'asc' },
      take: 50_000,
    });
    const buckets = new Map<string, { total: number; success: number; latencyTotal: number; count: number }>();
    const latencies: number[] = [];
    for (const run of runs) {
      const key = timeBucket(run.checkedAt, config.bucket);
      const bucket = buckets.get(key) ?? { total: 0, success: 0, latencyTotal: 0, count: 0 };
      bucket.total += 1;
      if (run.status === 'SUCCESS') {
        bucket.success += 1;
        if (run.latencyMs !== null) {
          bucket.latencyTotal += run.latencyMs;
          bucket.count += 1;
          latencies.push(run.latencyMs);
        }
      }
      buckets.set(key, bucket);
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null;
    return {
      range,
      totalChecks: runs.length,
      successfulChecks: runs.filter((run) => run.status === 'SUCCESS').length,
      uptime: percent(runs.filter((run) => run.status === 'SUCCESS').length, runs.length),
      avgLatency: latencies.length
        ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
        : null,
      p95Latency: p95,
      series: [...buckets.entries()].map(([timestamp, bucket]) => ({
        timestamp,
        uptime: percent(bucket.success, bucket.total),
        latencyMs: bucket.count ? Math.round(bucket.latencyTotal / bucket.count) : null,
        checks: bucket.total,
      })),
    };
  }

  private async assertService(projectId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, projectId },
      select: { id: true },
    });
    if (!service) throw new BadRequestException('Service does not belong to this project');
  }
}
