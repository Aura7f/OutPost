import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertEventType,
  IncidentSeverity,
  IncidentType,
  IntegrationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { PostgresMetricsProvider, type MetricSnapshot } from './database-metrics.provider';
import { IncidentsService } from '../../incidents/incidents.service';
import { AlertsService } from '../../notifications/alerts.service';
import { AuditService } from '../../audit/audit.service';
import { redactSecrets } from '../../common/crypto';
import { pagination, percent, safeJsonNumber } from '../../common/utils';
import type { AuthenticatedUser, TeamContext } from '../../common/types';

export interface MetricsRange {
  range?: '24h' | '7d' | '30d';
}

const PROVIDER_SETUP_NOTES = [
  'Create a dedicated PostgreSQL login with CONNECT and pg_read_all_stats only. Never use the postgres superuser or service-role credentials.',
  'Monitoring queries are read-only. Slow query text is normalized, truncated, and available to the team only.',
  'If pg_stat_statements is not installed, slow-query metrics are marked unavailable rather than fabricated.',
  'Database metrics require a direct or pooler connection URL with TLS. Anon and publishable keys cannot read PostgreSQL statistics.',
];

@Injectable()
export class DatabaseMetricsService {
  private readonly logger = new Logger(DatabaseMetricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly provider: PostgresMetricsProvider,
    private readonly incidents: IncidentsService,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  async executeScheduled(integrationId: string, jobId?: string) {
    return this.collect(integrationId, { scheduled: true, jobId });
  }

  async refresh(user: AuthenticatedUser, team: TeamContext, integrationId: string) {
    const integration = await this.integrations.getSecretIntegrationForTeam(team, integrationId);
    if (!integration.config.databaseUrl) {
      throw new BadRequestException('No PostgreSQL metrics connection is configured');
    }
    const metric = await this.collect(integration.id, {});
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: integration.projectId,
      action: 'database_metrics.refreshed',
      resourceType: 'Integration',
      resourceId: integration.id,
      metadata: { connectivity: 'connectivity' in metric ? metric.connectivity : null },
    });
    return metric;
  }

  async overview(team: TeamContext, projectId?: string) {
    if (projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, teamId: team.teamId },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('Project not found');
    }
    const integrations = await this.prisma.integration.findMany({
      where: {
        project: {
          teamId: team.teamId,
          ...(projectId ? { id: projectId } : {}),
        },
      },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        credentialHint: true,
        metricsEnabled: true,
        metricsIntervalMinutes: true,
        metricsNextRunAt: true,
        metricsConsecutiveFailures: true,
        lastError: true,
        project: { select: { id: true, name: true, environment: true } },
        databaseMetrics: {
          orderBy: { collectedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const ids = integrations.map((integration) => integration.id);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const metrics = ids.length
      ? await this.prisma.databaseMetric.findMany({
          where: { integrationId: { in: ids }, collectedAt: { gte: since } },
          orderBy: { collectedAt: 'asc' },
          take: 5000,
        })
      : [];
    const latest = metrics.at(-1);
    return {
      integrations: integrations.map((integration) => {
        const latestMetric = integration.databaseMetrics[0] ?? null;
        const perIntegration = metrics.filter((metric) => metric.integrationId === integration.id);
        return {
          ...integration,
          databaseMetrics: undefined,
          latestMetric: latestMetric ? this.serializeMetric(latestMetric) : null,
          trend: perIntegration.map((metric) => ({
            timestamp: metric.collectedAt,
            connectivity: metric.connectivity,
            connectionLatencyMs: metric.connectionLatencyMs,
            activeConnections: metric.activeConnections,
            databaseSizeBytes: safeJsonNumber(metric.databaseSizeBytes),
            locks: metric.locks,
          })),
        };
      }),
      summary: {
        connectedDatabases: integrations.length,
        reachable: integrations.filter((integration) => integration.databaseMetrics[0]?.connectivity).length,
        configuredForMetrics: integrations.filter((integration) => integration.metricsEnabled).length,
        activeConnections24h: latest?.activeConnections ?? null,
        totalSizeBytes: safeJsonNumber(
          metrics.reduce((total, metric) => total + (metric.databaseSizeBytes ?? 0n), 0n),
        ),
      },
      setupNotes: PROVIDER_SETUP_NOTES,
    };
  }

  async metricsFor(team: TeamContext, integrationId: string, range: MetricsRange) {
    const integration = await this.integrations.get(team, integrationId);
    const config = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    }[(range.range ?? '24h')];
    const since = new Date(Date.now() - config);
    const metrics = await this.prisma.databaseMetric.findMany({
      where: { integrationId, collectedAt: { gte: since } },
      orderBy: { collectedAt: 'asc' },
      take: 3000,
    });
    const latest = metrics.at(-1);
    return {
      integration,
      latest: latest ? this.serializeMetric(latest) : null,
      metrics: metrics.map((metric) => this.serializeMetric(metric)),
      setupNotes: PROVIDER_SETUP_NOTES,
    };
  }

  async latestForTeam(team: TeamContext, projectId?: string) {
    const result = await this.prisma.databaseMetric.findFirst({
      where: {
        integration: {
          project: {
            teamId: team.teamId,
            ...(projectId ? { id: projectId } : {}),
          },
        },
      },
      orderBy: { collectedAt: 'desc' },
      select: {
        connectivity: true,
        collectedAt: true,
        connectionLatencyMs: true,
        activeConnections: true,
      },
    });
    return result;
  }

  private async collect(
    integrationId: string,
    options: { scheduled?: boolean; jobId?: string },
  ) {
    const integration = await this.integrations.getSecretIntegrationInternal(integrationId);
    if (!integration) throw new NotFoundException('Integration not found');
    if (options.scheduled && !integration.metricsEnabled) {
      return { skipped: true, reason: 'metrics_disabled' };
    }
    if (!integration.config.databaseUrl) {
      throw new BadRequestException('No PostgreSQL metrics connection is configured');
    }
    const startedAt = Date.now();
    let snapshot: MetricSnapshot;
    try {
      snapshot = await this.provider.collect(integration.config.databaseUrl);
    } catch (error) {
      snapshot = {
        connectivity: false,
        connectionLatencyMs: null,
        activeConnections: null,
        maxConnections: null,
        databaseSizeBytes: null,
        longRunningQueries: null,
        locks: null,
        slowQueries: null,
        transactionStats: null,
        unavailableReasons: {},
        error: redactSecrets((error as Error).message, 500),
      };
    }
    const previousFailures = integration.metricsConsecutiveFailures;
    const consecutiveFailures = snapshot.connectivity ? 0 : previousFailures + 1;
    const now = new Date();
    const nextRunAt = integration.metricsEnabled
      ? new Date(now.getTime() + integration.metricsIntervalMinutes * 60_000)
      : null;
    const safeError = snapshot.error ? redactSecrets(snapshot.error, 500) : null;

    let metric;
    try {
      metric = await this.prisma.$transaction(async (tx) => {
        const created = await tx.databaseMetric.create({
          data: {
            integrationId: integration.id,
            jobId: options.jobId,
            connectivity: snapshot.connectivity,
            connectionLatencyMs: snapshot.connectionLatencyMs,
            activeConnections: snapshot.activeConnections,
            maxConnections: snapshot.maxConnections,
            databaseSizeBytes: snapshot.databaseSizeBytes,
            longRunningQueries: snapshot.longRunningQueries,
            locks: snapshot.locks,
            slowQueries: (snapshot.slowQueries ?? undefined) as Prisma.InputJsonValue | undefined,
            transactionStats: (snapshot.transactionStats ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
            unavailableReasons: snapshot.unavailableReasons as Prisma.InputJsonValue,
            error: safeError,
            collectedAt: now,
          },
        });
        await tx.integration.update({
          where: { id: integration.id },
          data: {
            status: snapshot.connectivity ? IntegrationStatus.CONNECTED : IntegrationStatus.ERROR,
            lastError: safeError,
            metricsConsecutiveFailures: consecutiveFailures,
            ...(options.scheduled ? { metricsNextRunAt: nextRunAt } : {}),
          },
        });
        return created;
      });
    } catch (dbError) {
      if ((dbError as { code?: string }).code === 'P2002' && options.jobId) {
        const existing = await this.prisma.databaseMetric.findUnique({ where: { jobId: options.jobId } });
        if (existing) return this.serializeMetric(existing);
      }
      throw dbError;
    }

    if (!options.scheduled || options.jobId) {
      try {
        if (!snapshot.connectivity) {
          const rule = await this.prisma.alertRule.findUnique({
            where: {
              projectId_type: {
                projectId: integration.projectId,
                type: AlertEventType.DATABASE_CONNECTION_FAILURE,
              },
            },
            select: { failureThreshold: true },
          });
          const threshold = rule?.failureThreshold ?? 3;
          if (consecutiveFailures >= threshold) {
            const incident = await this.incidents.open({
              projectId: integration.projectId,
              integrationId: integration.id,
              type: IncidentType.DATABASE,
              severity: IncidentSeverity.HIGH,
              title: `Database metrics failing for ${integration.name}`,
              summary: `Database connectivity or monitoring access has failed ${consecutiveFailures} consecutive times. ${safeError ?? ''}`.trim(),
              dedupeKey: `integration:${integration.id}:database:down`,
              metadata: { consecutiveFailures, credentialHint: integration.credentialHint },
            });
            await this.alerts.evaluate({
              teamId: integration.project.teamId,
              projectId: integration.projectId,
              projectName: integration.project.name,
              event: AlertEventType.DATABASE_CONNECTION_FAILURE,
              title: `Database connection failing for ${integration.name}`,
              summary: `The database metrics probe has failed ${consecutiveFailures} consecutive times. ${safeError ?? ''}`.trim(),
              severity: 'high',
              incidentId: incident.id,
              failureCount: consecutiveFailures,
              dashboardPath: `/databases?projectId=${integration.projectId}&integrationId=${integration.id}`,
            });
          }
        } else if (previousFailures > 0) {
          const resolved = await this.incidents.resolveByDedupeKey(
            `integration:${integration.id}:database:down`,
          );
          if (resolved) {
            await this.alerts.evaluate({
              teamId: integration.project.teamId,
              projectId: integration.projectId,
              projectName: integration.project.name,
              event: AlertEventType.RECOVERY,
              title: `Database monitoring recovered for ${integration.name}`,
              summary: 'Database metrics collection is succeeding again.',
              severity: 'info',
              incidentId: resolved.id,
              dashboardPath: `/databases?projectId=${integration.projectId}&integrationId=${integration.id}`,
            });
          }
        }
      } catch (processingError) {
        this.logger.error(`Database metrics post-processing failed: ${(processingError as Error).message}`);
      }
    }

    return this.serializeMetric(metric);
  }

  private serializeMetric<T extends { databaseSizeBytes: bigint | null; slowQueries?: unknown }>(
    metric: T,
  ) {
    return {
      ...metric,
      databaseSizeBytes: safeJsonNumber(metric.databaseSizeBytes),
    };
  }
}
