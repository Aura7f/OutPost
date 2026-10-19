import { Injectable, Logger } from '@nestjs/common';
import {
  AlertEventType,
  IncidentSeverity,
  IncidentType,
  MonitorHealth,
  RunStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SafeHttpService } from './safe-http.service';
import { IncidentsService } from '../../incidents/incidents.service';
import { AlertsService } from '../../notifications/alerts.service';
import { redactSecrets } from '../../common/crypto';

export interface ExecuteMonitorOptions {
  scheduled?: boolean;
  jobId?: string;
}

@Injectable()
export class HealthCheckExecutor {
  private readonly logger = new Logger(HealthCheckExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: SafeHttpService,
    private readonly incidents: IncidentsService,
    private readonly alerts: AlertsService,
  ) {}

  async execute(monitorId: string, options: ExecuteMonitorOptions = {}) {
    const monitor = await this.prisma.monitor.findUnique({
      where: { id: monitorId },
      include: {
        project: { select: { id: true, name: true, teamId: true, environment: true } },
        service: { select: { name: true } },
      },
    });
    if (!monitor) throw new Error('Monitor not found');
    if (!monitor.active && options.scheduled) {
      return { skipped: true, reason: 'inactive' };
    }

    const result = await this.http.check({
      url: monitor.url,
      method: monitor.method,
      expectedStatusCodes: monitor.expectedStatusCodes,
      timeoutMs: monitor.timeoutMs,
    });

    const runStatus: RunStatus = result.success
      ? RunStatus.SUCCESS
      : result.errorKind === 'TIMEOUT'
        ? RunStatus.TIMEOUT
        : result.errorKind === 'CONNECTION_ERROR'
          ? RunStatus.CONNECTION_ERROR
          : RunStatus.FAILURE;

    const wasDown = monitor.lastStatus === MonitorHealth.DOWN;
    const consecutiveFailures = result.success ? 0 : monitor.consecutiveFailures + 1;
    const now = new Date();

    let run;
    try {
      run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.monitorRun.create({
          data: {
            monitorId: monitor.id,
            jobId: options.jobId,
            status: runStatus,
            statusCode: result.statusCode,
            latencyMs: result.latencyMs,
            error: result.error ? redactSecrets(result.error, 800) : null,
            checkedAt: now,
          },
        });
        await tx.monitor.update({
          where: { id: monitor.id },
          data: {
            consecutiveFailures,
            lastStatus: result.success ? MonitorHealth.UP : MonitorHealth.DOWN,
            lastCheckedAt: now,
            lastLatencyMs: result.latencyMs,
            ...(options.scheduled
              ? { nextRunAt: new Date(now.getTime() + monitor.intervalSeconds * 1000) }
              : {}),
          },
        });
        return created;
      });
    } catch (error) {
      // A retried job may have already persisted this run before the worker
      // crashed. The unique jobId makes the retry idempotent.
      if ((error as { code?: string }).code === 'P2002' && options.jobId) {
        const existing = await this.prisma.monitorRun.findUnique({ where: { jobId: options.jobId } });
        if (existing) return existing;
      }
      throw error;
    }

    try {
      if (!result.success) {
        const rule = await this.prisma.alertRule.findUnique({
          where: { projectId_type: { projectId: monitor.projectId, type: AlertEventType.DOWNTIME } },
          select: { failureThreshold: true },
        });
        const threshold = Math.max(monitor.failureThreshold, rule?.failureThreshold ?? 0);
        if (consecutiveFailures >= threshold) {
          const incident = await this.incidents.open({
            projectId: monitor.projectId,
            monitorId: monitor.id,
            type: IncidentType.DOWNTIME,
            severity: IncidentSeverity.HIGH,
            title: `${monitor.name} is down`,
            summary: `${monitor.project.name} reports ${consecutiveFailures} consecutive failed health checks. ${
              result.error ?? `HTTP ${result.statusCode}`
            }`,
            dedupeKey: `monitor:${monitor.id}:down`,
            metadata: {
              url: monitor.url,
              lastStatusCode: result.statusCode,
              lastError: redactSecrets(result.error, 300),
              consecutiveFailures,
            },
          });
          await this.alerts.evaluate({
            teamId: monitor.project.teamId,
            projectId: monitor.projectId,
            projectName: monitor.project.name,
            event: AlertEventType.DOWNTIME,
            title: `${monitor.name} is down`,
            summary: `The endpoint failed ${consecutiveFailures} consecutive checks. ${result.error ?? ''}`.trim(),
            severity: 'critical',
            monitorName: monitor.name,
            serviceName: monitor.service?.name,
            incidentId: incident.id,
            failureCount: consecutiveFailures,
            dashboardPath: `/health?projectId=${monitor.projectId}&monitorId=${monitor.id}`,
          });
        }
      } else {
        if (wasDown) {
          const resolvedIncident = await this.incidents.resolveByDedupeKey(`monitor:${monitor.id}:down`);
          if (resolvedIncident) {
            await this.alerts.evaluate({
              teamId: monitor.project.teamId,
              projectId: monitor.projectId,
              projectName: monitor.project.name,
              event: AlertEventType.RECOVERY,
              title: `${monitor.name} recovered`,
              summary: `The endpoint is responding normally again with HTTP ${result.statusCode} in ${result.latencyMs}ms.`,
              severity: 'info',
              monitorName: monitor.name,
              serviceName: monitor.service?.name,
              incidentId: resolvedIncident.id,
              dashboardPath: `/health?projectId=${monitor.projectId}&monitorId=${monitor.id}`,
            });
          }
        }
        await this.alerts.evaluate({
          teamId: monitor.project.teamId,
          projectId: monitor.projectId,
          projectName: monitor.project.name,
          event: AlertEventType.HIGH_LATENCY,
          title: `High latency on ${monitor.name}`,
          summary: `The endpoint responded in ${result.latencyMs}ms, above the configured latency threshold.`,
          severity: 'warning',
          monitorName: monitor.name,
          serviceName: monitor.service?.name,
          latencyMs: result.latencyMs,
          dashboardPath: `/health?projectId=${monitor.projectId}&monitorId=${monitor.id}`,
        });
      }
    } catch (error) {
      this.logger.error(`Post-check processing failed for monitor ${monitor.id}: ${(error as Error).message}`);
    }

    return run;
  }
}
