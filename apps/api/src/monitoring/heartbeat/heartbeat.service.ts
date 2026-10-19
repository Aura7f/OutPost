import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertEventType,
  HeartbeatStatus,
  IncidentSeverity,
  IncidentType,
  IntegrationStatus,
  IntegrationType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { SafeHttpService } from '../health/safe-http.service';
import { IncidentsService } from '../../incidents/incidents.service';
import { AlertsService } from '../../notifications/alerts.service';
import { AuditService } from '../../audit/audit.service';
import { redactSecrets } from '../../common/crypto';
import { pagination } from '../../common/utils';
import type { AuthenticatedUser, TeamContext } from '../../common/types';
import type { HeartbeatHistoryQueryDto } from '../../integrations/integrations.dto';

export interface HeartbeatOptions {
  scheduled?: boolean;
  jobId?: string;
  verification?: boolean;
}

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly http: SafeHttpService,
    private readonly incidents: IncidentsService,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  async verify(user: AuthenticatedUser, team: TeamContext, integrationId: string) {
    const result = await this.executeForTeam(team, integrationId, { verification: true });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: result.projectId,
      action: 'integration.verified',
      resourceType: 'Integration',
      resourceId: integrationId,
      metadata: { status: result.status, statusCode: result.statusCode },
    });
    return {
      connected: result.status === HeartbeatStatus.SUCCESS,
      status: result.status,
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      error: result.error,
      message:
        result.status === HeartbeatStatus.SUCCESS
          ? 'Supabase heartbeat RPC completed successfully'
          : 'Heartbeat failed. Confirm the setup SQL was run and the publishable/anon key can execute outpost_heartbeat_ping.',
    };
  }

  async runManual(user: AuthenticatedUser, team: TeamContext, integrationId: string) {
    const result = await this.executeForTeam(team, integrationId, {});
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: result.projectId,
      action: 'heartbeat.manual_run',
      resourceType: 'Integration',
      resourceId: integrationId,
      metadata: { status: result.status },
    });
    return result;
  }

  async executeScheduled(integrationId: string, jobId?: string) {
    return this.execute(integrationId, { scheduled: true, jobId });
  }

  async history(team: TeamContext, integrationId: string, query: HeartbeatHistoryQueryDto) {
    const integration = await this.integrations.get(team, integrationId);
    const { skip, take, page, pageSize } = pagination(query.page, query.pageSize);
    const where = {
      integrationId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.heartbeatRun.findMany({
        where,
        orderBy: { executedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.heartbeatRun.count({ where }),
    ]);
    return { integration, items, total, page, pageSize };
  }

  async summary(team: TeamContext, integrationId: string) {
    const integration = await this.integrations.get(team, integrationId);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [runs, total, success] = await this.prisma.$transaction([
      this.prisma.heartbeatRun.findMany({
        where: { integrationId, executedAt: { gte: since } },
        orderBy: { executedAt: 'desc' },
        take: 30,
      }),
      this.prisma.heartbeatRun.count({ where: { integrationId, executedAt: { gte: since } } }),
      this.prisma.heartbeatRun.count({
        where: { integrationId, executedAt: { gte: since }, status: HeartbeatStatus.SUCCESS },
      }),
    ]);
    return {
      integration,
      runs,
      totals: {
        last24h: total,
        success24h: success,
        failed24h: total - success,
        successRate: total ? Math.round((success / total) * 10000) / 100 : null,
      },
    };
  }

  private async executeForTeam(team: TeamContext, integrationId: string, options: HeartbeatOptions) {
    const integration = await this.integrations.getSecretIntegrationForTeam(team, integrationId);
    return this.execute(integration.id, { ...options, projectId: integration.projectId });
  }

  private async execute(
    integrationId: string,
    options: HeartbeatOptions & { projectId?: string },
  ) {
    const integration = await this.integrations.getSecretIntegrationInternal(integrationId);
    if (!integration) throw new NotFoundException('Integration not found');
    if (integration.type !== IntegrationType.SUPABASE) {
      throw new BadRequestException('Heartbeat is only supported for Supabase integrations');
    }
    if (!integration.config.supabaseUrl || !integration.config.apiKey) {
      throw new BadRequestException('Supabase credentials are missing');
    }
    if (options.scheduled && !integration.heartbeatEnabled) {
      return { skipped: true, reason: 'heartbeat_disabled', projectId: integration.projectId };
    }

    const result = await this.http.postJson({
      url: `${integration.config.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/outpost_heartbeat_ping`,
      headers: {
        apikey: integration.config.apiKey,
        authorization: `Bearer ${integration.config.apiKey}`,
      },
      body: {},
      timeoutMs: 10_000,
      maxResponseBytes: 16 * 1024,
    });

    let error = result.error;
    if (!result.ok && !error) {
      error = `Supabase RPC returned HTTP ${result.statusCode}`;
      try {
        const parsed = JSON.parse(result.body) as { message?: string; error?: string; hint?: string };
        const message = parsed.message || parsed.error || parsed.hint;
        if (message) error = `${error}: ${message}`;
      } catch {
        // Keep the status-only error to avoid persisting an arbitrary response body.
      }
    }
    const safeError = error
      ? redactSecrets(error, 500)
      : null;
    const status = result.ok ? HeartbeatStatus.SUCCESS : HeartbeatStatus.FAILURE;
    const previousFailures = integration.heartbeatConsecutiveFailures;
    const consecutiveFailures = result.ok ? 0 : previousFailures + 1;
    const now = new Date();
    const nextRunAt = integration.heartbeatEnabled
      ? new Date(now.getTime() + integration.heartbeatIntervalMinutes * 60_000)
      : null;

    let run;
    try {
      run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.heartbeatRun.create({
          data: {
            integrationId: integration.id,
            jobId: options.jobId,
            status,
            latencyMs: result.latencyMs,
            statusCode: result.statusCode,
            error: safeError,
            executedAt: now,
          },
        });
        await tx.integration.update({
          where: { id: integration.id },
          data: {
            status: result.ok ? IntegrationStatus.CONNECTED : IntegrationStatus.ERROR,
            lastError: safeError,
            heartbeatLastAttemptAt: now,
            ...(result.ok ? { heartbeatLastSuccessAt: now } : {}),
            heartbeatConsecutiveFailures: consecutiveFailures,
            ...(options.scheduled ? { heartbeatNextRunAt: nextRunAt } : {}),
          },
        });
        return created;
      });
    } catch (dbError) {
      if ((dbError as { code?: string }).code === 'P2002' && options.jobId) {
        const existing = await this.prisma.heartbeatRun.findUnique({ where: { jobId: options.jobId } });
        if (existing) return { ...existing, projectId: integration.projectId };
      }
      throw dbError;
    }

    if (!options.verification) {
      try {
        if (!result.ok) {
          const rule = await this.prisma.alertRule.findUnique({
            where: {
              projectId_type: {
                projectId: integration.projectId,
                type: AlertEventType.HEARTBEAT_FAILURE,
              },
            },
            select: { failureThreshold: true },
          });
          const threshold = rule?.failureThreshold ?? 3;
          if (consecutiveFailures >= threshold) {
            const incident = await this.incidents.open({
              projectId: integration.projectId,
              integrationId: integration.id,
              type: IncidentType.HEARTBEAT_FAILURE,
              severity: IncidentSeverity.HIGH,
              title: `Heartbeat failing for ${integration.name}`,
              summary: `The Supabase heartbeat RPC failed ${consecutiveFailures} consecutive times. ${safeError ?? ''}`.trim(),
              dedupeKey: `integration:${integration.id}:heartbeat:down`,
              metadata: { consecutiveFailures, credentialHint: integration.credentialHint },
            });
            await this.alerts.evaluate({
              teamId: integration.project.teamId,
              projectId: integration.projectId,
              projectName: integration.project.name,
              event: AlertEventType.HEARTBEAT_FAILURE,
              title: `Heartbeat failing for ${integration.name}`,
              summary: `The Supabase heartbeat RPC has failed ${consecutiveFailures} consecutive times. ${safeError ?? ''}`.trim(),
              severity: 'high',
              incidentId: incident.id,
              failureCount: consecutiveFailures,
              dashboardPath: `/heartbeat?projectId=${integration.projectId}&integrationId=${integration.id}`,
            });
          }
        } else if (previousFailures > 0) {
          const resolved = await this.incidents.resolveByDedupeKey(
            `integration:${integration.id}:heartbeat:down`,
          );
          if (resolved) {
            await this.alerts.evaluate({
              teamId: integration.project.teamId,
              projectId: integration.projectId,
              projectName: integration.project.name,
              event: AlertEventType.RECOVERY,
              title: `Heartbeat recovered for ${integration.name}`,
              summary: 'The Supabase heartbeat RPC is completing successfully again.',
              severity: 'info',
              incidentId: resolved.id,
              dashboardPath: `/heartbeat?projectId=${integration.projectId}&integrationId=${integration.id}`,
            });
          }
        }
      } catch (processingError) {
        this.logger.error(`Heartbeat post-processing failed: ${(processingError as Error).message}`);
      }
    }

    return {
      id: run.id,
      projectId: integration.projectId,
      status: run.status,
      statusCode: run.statusCode,
      latencyMs: run.latencyMs,
      error: run.error,
      executedAt: run.executedAt,
    };
  }
}
