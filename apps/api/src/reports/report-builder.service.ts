import { Injectable } from '@nestjs/common';
import { ErrorStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { percent, safeJsonNumber } from '../common/utils';

export interface ReportSnapshot {
  version: 1;
  project: {
    name: string;
    environment: string;
    description: string | null;
  };
  period: { start: string; end: string };
  generatedAt: string;
  summary: {
    monitors: number;
    healthyMonitors: number;
    uptime: number | null;
    avgResponseMs: number | null;
    peakResponseMs: number | null;
    errorEvents: number;
    unresolvedErrorGroups: number;
    openIncidents: number;
    resolvedIncidents: number;
    heartbeatExecutions: number;
    heartbeatFailures: number;
    connectedDatabases: number;
    monitoringAvailability: number | null;
    expectedChecks: number;
    recordedChecks: number;
  };
  monitors: Array<{
    name: string;
    service: string | null;
    method: string;
    intervalSeconds: number;
    uptime: number;
    totalChecks: number;
    successfulChecks: number;
    avgResponseMs: number | null;
    peakResponseMs: number | null;
    lastStatus: string;
    expectedChecks: number;
    availability: number | null;
  }>;
  errorBreakdown: Array<{
    errorType: string;
    serviceName: string;
    severity: string;
    status: string;
    events: number;
  }>;
  errorTrend: Array<{ date: string; count: number }>;
  databases: Array<{
    name: string;
    connectivity: boolean | null;
    avgConnectionLatencyMs: number | null;
    peakActiveConnections: number | null;
    databaseSizeBytes: number | null;
    longRunningQueries: number | null;
    locks: number | null;
    samples: number;
    failedSamples: number;
    unavailableReasons: string[];
    collectedAt: string | null;
  }>;
  incidents: Array<{
    title: string;
    type: string;
    severity: string;
    status: string;
    startedAt: string;
    resolvedAt: string | null;
    durationMinutes: number | null;
  }>;
  heartbeats: Array<{
    name: string;
    executions: number;
    failures: number;
    successRate: number | null;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
  }>;
  monitoringTimeline: Array<{
    date: string;
    checks: number;
    uptime: number;
    avgLatencyMs: number | null;
  }>;
  dataNotes: string[];
}

interface BuildInput {
  projectId: string;
  teamId: string;
  start: Date;
  end: Date;
}

/**
 * Builds an immutable report from real monitoring records. The snapshot is
 * intentionally free of credentials, request bodies, stack traces, and raw SQL.
 */
@Injectable()
export class ReportBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async build(input: BuildInput): Promise<ReportSnapshot> {
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, teamId: input.teamId },
      select: { id: true, name: true, description: true, environment: true },
    });
    if (!project) throw new Error('Project not found for report');

    const monitors = await this.prisma.monitor.findMany({
      where: { projectId: project.id },
      select: {
        id: true,
        name: true,
        method: true,
        intervalSeconds: true,
        lastStatus: true,
        createdAt: true,
        service: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });
    const monitorIds = monitors.map((monitor) => monitor.id);
    const periodFilter = { gte: input.start, lte: input.end };

    const [runGroups, allRuns, errorEventCount, unresolvedErrors, errorEventGroups, incidents, integrations] =
      await Promise.all([
        monitorIds.length
          ? this.prisma.monitorRun.groupBy({
              by: ['monitorId', 'status'],
              where: { monitorId: { in: monitorIds }, checkedAt: periodFilter },
              _count: true,
              _avg: { latencyMs: true },
              _max: { latencyMs: true },
            })
          : Promise.resolve([]),
        this.prisma.monitorRun.aggregate({
          where: { monitor: { projectId: project.id }, checkedAt: periodFilter, status: 'SUCCESS' },
          _avg: { latencyMs: true },
          _max: { latencyMs: true },
        }),
        this.prisma.errorEvent.count({
          where: { projectId: project.id, timestamp: periodFilter },
        }),
        this.prisma.errorGroup.count({
          where: { projectId: project.id, status: ErrorStatus.UNRESOLVED },
        }),
        this.prisma.errorEvent.groupBy({
          by: ['errorGroupId'],
          where: { projectId: project.id, timestamp: periodFilter },
          _count: { errorGroupId: true },
          orderBy: { _count: { errorGroupId: 'desc' } },
          take: 10,
        }),
        this.prisma.incident.findMany({
          where: {
            projectId: project.id,
            OR: [
              { startedAt: periodFilter },
              { resolvedAt: periodFilter },
            ],
          },
          select: {
            title: true,
            type: true,
            severity: true,
            status: true,
            startedAt: true,
            resolvedAt: true,
          },
          orderBy: { startedAt: 'desc' },
          take: 50,
        }),
        this.prisma.integration.findMany({
          where: { projectId: project.id },
          select: {
            id: true,
            name: true,
            type: true,
            heartbeatLastSuccessAt: true,
            heartbeatLastAttemptAt: true,
            databaseMetrics: {
              where: { collectedAt: periodFilter },
              orderBy: { collectedAt: 'desc' },
              take: 5000,
              select: {
                connectivity: true,
                connectionLatencyMs: true,
                activeConnections: true,
                databaseSizeBytes: true,
                longRunningQueries: true,
                locks: true,
                unavailableReasons: true,
                collectedAt: true,
              },
            },
            heartbeatRuns: {
              where: { executedAt: periodFilter },
              select: { status: true },
            },
          },
        }),
      ]);

    const errorGroups =
      errorEventGroups.length > 0
        ? await this.prisma.errorGroup.findMany({
            where: {
              id: { in: errorEventGroups.map((group) => group.errorGroupId) },
              projectId: project.id,
            },
            select: {
              id: true,
              errorType: true,
              serviceName: true,
              severity: true,
              status: true,
            },
          })
        : [];
    const errorGroupMap = new Map(errorGroups.map((group) => [group.id, group]));

    const monitorRows: ReportSnapshot['monitors'] = [];
    let totalChecks = 0;
    let successfulChecks = 0;
    let expectedChecks = 0;
    for (const monitor of monitors) {
      const groups = runGroups.filter((group) => group.monitorId === monitor.id);
      const checks = groups.reduce((sum, group) => sum + group._count, 0);
      const successes = groups
        .filter((group) => group.status === 'SUCCESS')
        .reduce((sum, group) => sum + group._count, 0);
      const latencyGroups = groups.filter((group) => group.status === 'SUCCESS');
      const avgResponse =
        latencyGroups.length > 0
          ? latencyGroups.reduce((sum, group) => sum + (group._avg.latencyMs ?? 0) * group._count, 0) /
            Math.max(1, latencyGroups.reduce((sum, group) => sum + group._count, 0))
          : null;
      const peak = latencyGroups.reduce<number | null>(
        (max, group) => (group._max.latencyMs !== null ? Math.max(max ?? 0, group._max.latencyMs) : max),
        null,
      );
      const effectiveStart = new Date(Math.max(monitor.createdAt.getTime(), input.start.getTime()));
      const expected = Math.max(
        0,
        Math.floor((input.end.getTime() - effectiveStart.getTime()) / (monitor.intervalSeconds * 1000)),
      );
      totalChecks += checks;
      successfulChecks += successes;
      expectedChecks += expected;
      monitorRows.push({
        name: monitor.name,
        service: monitor.service?.name ?? null,
        method: monitor.method,
        intervalSeconds: monitor.intervalSeconds,
        uptime: percent(successes, checks),
        totalChecks: checks,
        successfulChecks: successes,
        avgResponseMs: avgResponse === null ? null : Math.round(avgResponse),
        peakResponseMs: peak,
        lastStatus: monitor.lastStatus,
        expectedChecks: expected,
        availability: percent(checks, expected),
      });
    }

    const databases: ReportSnapshot['databases'] = [];
    const heartbeats: ReportSnapshot['heartbeats'] = [];
    for (const integration of integrations) {
      if (integration.databaseMetrics.length > 0 || integration.type === 'POSTGRESQL') {
        const metricRows = integration.databaseMetrics;
        const latest = metricRows[0];
        const latencyValues = metricRows
          .map((metric) => metric.connectionLatencyMs)
          .filter((value): value is number => value !== null);
        const unavailable = latest?.unavailableReasons as Record<string, unknown> | undefined;
        databases.push({
          name: integration.name,
          connectivity: latest?.connectivity ?? null,
          avgConnectionLatencyMs: latencyValues.length
            ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
            : null,
          peakActiveConnections: metricRows.reduce<number | null>(
            (max, metric) =>
              metric.activeConnections !== null ? Math.max(max ?? 0, metric.activeConnections) : max,
            null,
          ),
          databaseSizeBytes: safeJsonNumber(latest?.databaseSizeBytes),
          longRunningQueries: latest?.longRunningQueries ?? null,
          locks: latest?.locks ?? null,
          samples: metricRows.length,
          failedSamples: metricRows.filter((metric) => !metric.connectivity).length,
          unavailableReasons: unavailable ? Object.values(unavailable).map(String).slice(0, 5) : [],
          collectedAt: latest?.collectedAt.toISOString() ?? null,
        });
      }
      if (integration.heartbeatRuns.length > 0 || integration.heartbeatLastAttemptAt) {
        const executions = integration.heartbeatRuns.length;
        const failures = integration.heartbeatRuns.filter((run) => run.status === 'FAILURE').length;
        heartbeats.push({
          name: integration.name,
          executions,
          failures,
          successRate: executions ? percent(executions - failures, executions) : null,
          lastSuccessAt: integration.heartbeatLastSuccessAt?.toISOString() ?? null,
          lastAttemptAt: integration.heartbeatLastAttemptAt?.toISOString() ?? null,
        });
      }
    }

    const timeline = await this.prisma.$queryRaw<
      Array<{ day: Date; total: bigint; success: bigint; latency: number | null }>
    >(Prisma.sql`
      SELECT date_trunc('day', r."checkedAt") AS day,
             count(*)::bigint AS total,
             count(*) FILTER (WHERE r.status = 'SUCCESS')::bigint AS success,
             avg(r."latencyMs") FILTER (WHERE r.status = 'SUCCESS') AS latency
      FROM "MonitorRun" r
      JOIN "Monitor" m ON m.id = r."monitorId"
      WHERE m."projectId" = ${project.id}::uuid
        AND r."checkedAt" >= ${input.start}
        AND r."checkedAt" <= ${input.end}
      GROUP BY 1
      ORDER BY 1
    `);
    const errorTrend = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>(Prisma.sql`
      SELECT date_trunc('day', e."timestamp") AS day, count(*)::bigint AS count
      FROM "ErrorEvent" e
      WHERE e."projectId" = ${project.id}::uuid
        AND e."timestamp" >= ${input.start}
        AND e."timestamp" <= ${input.end}
      GROUP BY 1
      ORDER BY 1
    `);

    const dataNotes: string[] = [
      'Only monitoring data recorded by Outpost during the report period is included.',
      'Uptime is calculated from completed HTTP checks and is not a guarantee of future availability.',
      'Database statistics depend on the least-privilege monitoring role and may be unavailable for provider or permission reasons.',
      'Monitoring availability compares recorded checks with scheduled checks and can be affected by deploy windows or scheduler limits.',
      'Stack traces, request bodies, credentials, raw SQL, and private error messages are intentionally excluded from shared reports.',
    ];
    if (databases.some((database) => database.unavailableReasons.length > 0)) {
      dataNotes.push('One or more database metrics were unavailable due to provider permissions or extension limitations.');
    }

    const heartbeatExecutions = heartbeats.reduce((sum, item) => sum + item.executions, 0);
    const heartbeatFailures = heartbeats.reduce((sum, item) => sum + item.failures, 0);

    return {
      version: 1,
      project: {
        name: project.name,
        environment: project.environment,
        description: project.description,
      },
      period: { start: input.start.toISOString(), end: input.end.toISOString() },
      generatedAt: new Date().toISOString(),
      summary: {
        monitors: monitors.length,
        healthyMonitors: monitors.filter((monitor) => monitor.lastStatus === 'UP').length,
        uptime: totalChecks ? percent(successfulChecks, totalChecks) : null,
        avgResponseMs:
          allRuns._avg.latencyMs !== null ? Math.round(allRuns._avg.latencyMs) : null,
        peakResponseMs: allRuns._max.latencyMs,
        errorEvents: errorEventCount,
        unresolvedErrorGroups: unresolvedErrors,
        openIncidents: incidents.filter((incident) => incident.status !== 'RESOLVED').length,
        resolvedIncidents: incidents.filter((incident) => incident.status === 'RESOLVED').length,
        heartbeatExecutions,
        heartbeatFailures,
        connectedDatabases: databases.filter((database) => database.connectivity).length,
        monitoringAvailability: expectedChecks ? percent(totalChecks, expectedChecks) : null,
        expectedChecks,
        recordedChecks: totalChecks,
      },
      monitors: monitorRows,
      errorBreakdown: errorEventGroups.map((row) => {
        const group = errorGroupMap.get(row.errorGroupId);
        return {
          errorType: group?.errorType ?? 'Unknown',
          serviceName: group?.serviceName ?? 'Unknown',
          severity: group?.severity ?? 'ERROR',
          status: group?.status ?? 'UNRESOLVED',
          events: row._count.errorGroupId,
        };
      }),
      errorTrend: errorTrend.map((row) => ({
        date: new Date(row.day).toISOString().slice(0, 10),
        count: Number(row.count),
      })),
      databases,
      incidents: incidents.map((incident) => ({
        title: incident.title,
        type: incident.type,
        severity: incident.severity,
        status: incident.status,
        startedAt: incident.startedAt.toISOString(),
        resolvedAt: incident.resolvedAt?.toISOString() ?? null,
        durationMinutes: incident.resolvedAt
          ? Math.round((incident.resolvedAt.getTime() - incident.startedAt.getTime()) / 60000)
          : null,
      })),
      heartbeats,
      monitoringTimeline: timeline.map((row) => ({
        date: new Date(row.day).toISOString().slice(0, 10),
        checks: Number(row.total),
        uptime: percent(Number(row.success), Number(row.total)),
        avgLatencyMs: row.latency !== null ? Math.round(Number(row.latency)) : null,
      })),
      dataNotes,
    };
  }
}
