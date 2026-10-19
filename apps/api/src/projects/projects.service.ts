import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertEventType, Environment, MonitorHealth } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateToken, sha256 } from '../common/crypto';
import { percent, safeJsonNumber } from '../common/utils';
import type { AuthenticatedUser, TeamContext } from '../common/types';
import type { CreateProjectDto, CreateServiceDto, UpdateProjectDto, UpdateServiceDto } from './projects.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(team: TeamContext) {
    const projects = await this.prisma.project.findMany({
      where: { teamId: team.teamId },
      select: {
        id: true,
        name: true,
        description: true,
        environment: true,
        ingestionKeyPrefix: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { services: true, monitors: true, errorGroups: true, integrations: true },
        },
        monitors: {
          where: { active: true },
          select: { lastStatus: true, lastCheckedAt: true },
        },
        incidents: {
          where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return projects.map((project) => {
      const health = project.monitors.some((m) => m.lastStatus === MonitorHealth.DOWN)
        ? 'DOWN'
        : project.monitors.length === 0
          ? 'UNKNOWN'
          : project.monitors.every((m) => m.lastStatus === MonitorHealth.UP)
            ? 'UP'
            : 'PARTIAL';
      return {
        ...project,
        health,
        openIncidents: project.incidents.length,
        monitors: project.monitors.length,
        incidents: undefined,
      };
    });
  }

  async create(user: AuthenticatedUser, team: TeamContext, dto: CreateProjectDto) {
    const key = generateToken('opk');
    const project = await this.prisma.project.create({
      data: {
        teamId: team.teamId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        environment: dto.environment ?? Environment.PRODUCTION,
        ingestionKeyHash: sha256(key),
        ingestionKeyPrefix: key.slice(0, 12),
      },
      select: {
        id: true,
        name: true,
        description: true,
        environment: true,
        ingestionKeyPrefix: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await this.prisma.alertRule.createMany({
      data: Object.values(AlertEventType).map((type) => ({
        projectId: project.id,
        type,
        enabled: false,
        recipients: [user.email.toLowerCase()],
        cooldownMinutes: 30,
        failureThreshold: 3,
        latencyThresholdMs: 2000,
      })),
      skipDuplicates: true,
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: project.id,
      action: 'project.created',
      resourceType: 'Project',
      resourceId: project.id,
      metadata: { name: project.name },
    });
    return { ...project, ingestionKey: key };
  }

  async get(team: TeamContext, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, teamId: team.teamId },
      select: {
        id: true,
        name: true,
        description: true,
        environment: true,
        ingestionKeyPrefix: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { services: true, monitors: true, errorGroups: true, integrations: true, reports: true } },
        services: {
          select: {
            id: true,
            name: true,
            environment: true,
            runtime: true,
            _count: { select: { monitors: true } },
          },
          orderBy: { name: 'asc' },
        },
        integrations: {
          select: {
            id: true,
            name: true,
            type: true,
            status: true,
            heartbeatEnabled: true,
            heartbeatIntervalMinutes: true,
            heartbeatLastSuccessAt: true,
            metricsEnabled: true,
            metricsIntervalMinutes: true,
            lastError: true,
            credentialHint: true,
            createdAt: true,
          },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(user: AuthenticatedUser, team: TeamContext, projectId: string, dto: UpdateProjectDto) {
    await this.requireProject(team, projectId);
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.environment !== undefined ? { environment: dto.environment } : {}),
      },
      select: {
        id: true,
        name: true,
        description: true,
        environment: true,
        ingestionKeyPrefix: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId,
      action: 'project.updated',
      resourceType: 'Project',
      resourceId: projectId,
      metadata: { fields: Object.keys(dto) },
    });
    return project;
  }

  async delete(user: AuthenticatedUser, team: TeamContext, projectId: string) {
    const project = await this.requireProject(team, projectId);
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId,
      action: 'project.deleted',
      resourceType: 'Project',
      resourceId: projectId,
      metadata: { name: project.name },
    });
    await this.prisma.project.delete({ where: { id: projectId } });
    return { deleted: true };
  }

  async rotateIngestionKey(user: AuthenticatedUser, team: TeamContext, projectId: string) {
    await this.requireProject(team, projectId);
    const key = generateToken('opk');
    const result = await this.prisma.project.update({
      where: { id: projectId },
      data: { ingestionKeyHash: sha256(key), ingestionKeyPrefix: key.slice(0, 12) },
      select: { id: true, ingestionKeyPrefix: true },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId,
      action: 'project.ingestion_key_rotated',
      resourceType: 'Project',
      resourceId: projectId,
    });
    return { ...result, ingestionKey: key };
  }

  async listServices(team: TeamContext, projectId: string) {
    await this.requireProject(team, projectId);
    return this.prisma.service.findMany({
      where: { projectId },
      include: {
        _count: { select: { monitors: true, errors: true } },
        monitors: {
          select: { id: true, name: true, lastStatus: true, lastCheckedAt: true, active: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createService(
    user: AuthenticatedUser,
    team: TeamContext,
    projectId: string,
    dto: CreateServiceDto,
  ) {
    const project = await this.requireProject(team, projectId);
    const service = await this.prisma.service.create({
      data: {
        projectId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        environment: dto.environment ?? project.environment,
        runtime: dto.runtime?.trim() || null,
      },
      include: { _count: { select: { monitors: true, errors: true } } },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId,
      action: 'service.created',
      resourceType: 'Service',
      resourceId: service.id,
      metadata: { name: service.name },
    });
    return service;
  }

  async updateService(
    user: AuthenticatedUser,
    team: TeamContext,
    serviceId: string,
    dto: UpdateServiceDto,
  ) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, project: { teamId: team.teamId } },
      select: { id: true, projectId: true },
    });
    if (!service) throw new NotFoundException('Service not found');
    const updated = await this.prisma.service.update({
      where: { id: service.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.environment !== undefined ? { environment: dto.environment } : {}),
        ...(dto.runtime !== undefined ? { runtime: dto.runtime?.trim() || null } : {}),
      },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: service.projectId,
      action: 'service.updated',
      resourceType: 'Service',
      resourceId: serviceId,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async deleteService(user: AuthenticatedUser, team: TeamContext, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, project: { teamId: team.teamId } },
      select: { id: true, projectId: true, name: true },
    });
    if (!service) throw new NotFoundException('Service not found');
    await this.prisma.service.delete({ where: { id: service.id } });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: service.projectId,
      action: 'service.deleted',
      resourceType: 'Service',
      resourceId: serviceId,
      metadata: { name: service.name },
    });
    return { deleted: true };
  }

  async dashboard(team: TeamContext, projectId: string) {
    const project = await this.requireProject(team, projectId);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [monitors, integrations, incidents, errors, runs, latestErrors, heartbeat] =
      await Promise.all([
        this.prisma.monitor.findMany({
          where: { projectId },
          select: {
            id: true,
            name: true,
            url: true,
            lastStatus: true,
            lastCheckedAt: true,
            lastLatencyMs: true,
            active: true,
            intervalSeconds: true,
            service: { select: { id: true, name: true } },
          },
          orderBy: { name: 'asc' },
        }),
        this.prisma.integration.findMany({
          where: { projectId },
          select: {
            id: true,
            name: true,
            type: true,
            status: true,
            heartbeatEnabled: true,
            heartbeatIntervalMinutes: true,
            heartbeatLastSuccessAt: true,
            metricsEnabled: true,
            metricsIntervalMinutes: true,
            lastError: true,
          },
        }),
        this.prisma.incident.findMany({
          where: { projectId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
          orderBy: { startedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            title: true,
            type: true,
            severity: true,
            status: true,
            startedAt: true,
          },
        }),
        this.prisma.errorGroup.aggregate({
          where: { projectId, status: 'UNRESOLVED' },
          _sum: { eventCount: true },
          _count: true,
        }),
        this.prisma.monitorRun.findMany({
          where: { monitor: { projectId }, checkedAt: { gte: since } },
          select: { status: true, latencyMs: true, checkedAt: true, monitorId: true },
          orderBy: { checkedAt: 'asc' },
        }),
        this.prisma.errorGroup.findMany({
          where: { projectId, status: 'UNRESOLVED' },
          orderBy: { lastSeen: 'desc' },
          take: 5,
          select: {
            id: true,
            errorType: true,
            message: true,
            serviceName: true,
            severity: true,
            eventCount: true,
            lastSeen: true,
          },
        }),
        this.prisma.heartbeatRun.findFirst({
          where: { integration: { projectId, heartbeatEnabled: true } },
          orderBy: { executedAt: 'desc' },
          select: { status: true, executedAt: true, integrationId: true },
        }),
      ]);

    const successful = runs.filter((run) => run.status === 'SUCCESS');
    const latencies = successful.map((run) => run.latencyMs).filter((v): v is number => v !== null);
    const metrics = integrations.length
      ? await this.prisma.databaseMetric.findMany({
          where: { integration: { projectId }, collectedAt: { gte: since } },
          orderBy: { collectedAt: 'asc' },
          take: 200,
          select: {
            id: true,
            integrationId: true,
            connectivity: true,
            connectionLatencyMs: true,
            activeConnections: true,
            databaseSizeBytes: true,
            locks: true,
            collectedAt: true,
          },
        })
      : [];

    // Build a 24h latency series with 30-minute buckets.
    const buckets = new Map<string, { total: number; count: number }>();
    for (const run of successful) {
      if (run.latencyMs === null) continue;
      const bucketDate = new Date(run.checkedAt);
      bucketDate.setUTCMinutes(Math.floor(bucketDate.getUTCMinutes() / 30) * 30, 0, 0);
      const key = bucketDate.toISOString();
      const existing = buckets.get(key) ?? { total: 0, count: 0 };
      existing.total += run.latencyMs;
      existing.count += 1;
      buckets.set(key, existing);
    }

    return {
      project,
      summary: {
        services: project._count.services,
        monitors: monitors.length,
        healthy: monitors.filter((m) => m.lastStatus === 'UP').length,
        down: monitors.filter((m) => m.lastStatus === 'DOWN').length,
        unknown: monitors.filter((m) => m.lastStatus === 'UNKNOWN').length,
        activeIncidents: incidents.length,
        unresolvedErrorGroups: errors._count,
        errorEvents: errors._sum.eventCount ?? 0,
        uptime: percent(successful.length, runs.length),
        avgLatency: latencies.length
          ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
          : null,
        lastHeartbeat: heartbeat,
      },
      monitors,
      integrations: integrations.map((integration) => ({
        ...integration,
        latestMetrics: metrics.filter((m) => m.integrationId === integration.id).at(-1) ?? null,
      })),
      incidents,
      recentErrors: latestErrors,
      latencySeries: [...buckets.entries()].map(([timestamp, value]) => ({
        timestamp,
        latencyMs: Math.round(value.total / value.count),
      })),
      metrics: metrics.map((metric) => ({
        ...metric,
        databaseSizeBytes: safeJsonNumber(metric.databaseSizeBytes),
      })),
    };
  }

  async requireProject(team: TeamContext, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, teamId: team.teamId },
      select: {
        id: true,
        teamId: true,
        name: true,
        environment: true,
        description: true,
        ingestionKeyPrefix: true,
        createdAt: true,
        _count: { select: { services: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }
}
