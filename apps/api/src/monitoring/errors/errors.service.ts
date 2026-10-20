import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AlertEventType,
  Environment,
  ErrorSeverity,
  ErrorStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AlertsService } from '../../notifications/alerts.service';
import { pagination, percent, timeBucket } from '../../common/utils';
import { redactSecrets, sha256 } from '../../common/crypto';
import {
  deriveSeverity,
  fingerprintError,
  normalizeEnvironment,
  sanitizeMetadata,
  sanitizeStackTrace,
} from './error-sanitizer';
import type { AuthenticatedUser, TeamContext } from '../../common/types';
import type {
  ErrorEventsQueryDto,
  ErrorGroupsQueryDto,
  IngestErrorsDto,
  IngestErrorEventDto,
  UpdateErrorGroupDto,
} from './errors.dto';

@Injectable()
export class ErrorsService {
  private readonly logger = new Logger(ErrorsService.name);
  private readonly ingestionWindows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  async ingest(ingestionKey: string | undefined, dto: IngestErrorsDto) {
    if (!ingestionKey || !ingestionKey.startsWith('opk_')) {
      throw new UnauthorizedException('Invalid ingestion key');
    }
    if (ingestionKey.length > 200) throw new UnauthorizedException('Invalid ingestion key');
    const project = await this.prisma.project.findUnique({
      where: { ingestionKeyHash: sha256(ingestionKey) },
      select: {
        id: true,
        name: true,
        teamId: true,
        environment: true,
      },
    });
    if (!project) throw new UnauthorizedException('Invalid ingestion key');
    this.checkRateLimit(project.id);

    const services = await this.prisma.service.findMany({
      where: {
        projectId: project.id,
        name: { in: [...new Set(dto.events.map((event) => event.serviceName))], mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
    const servicesByName = new Map(services.map((service) => [service.name.toLowerCase(), service.id]));
    const accepted: Array<{ id: string; groupId: string; fingerprint: string }> = [];
    let newGroups = 0;

    for (const event of dto.events) {
      const result = await this.ingestOne(
        project,
        event,
        servicesByName.get(event.serviceName.toLowerCase()),
      );
      accepted.push(result);
      if (result.isNew) {
        newGroups += 1;
        try {
          await this.alerts.evaluate({
            teamId: project.teamId,
            projectId: project.id,
            projectName: project.name,
            event: AlertEventType.NEW_ERROR,
            title: `New ${result.errorType} in ${event.serviceName}`,
            summary: `A new error group was detected in ${event.serviceName} (${result.environment.toLowerCase()}). Open Outpost to review the sanitized stack trace.`,
            severity: 'warning',
            serviceName: event.serviceName,
            dashboardPath: `/errors?projectId=${project.id}&groupId=${result.groupId}`,
          });
          await this.prisma.errorGroup.update({
            where: { id: result.groupId },
            data: { lastAlertedAt: new Date() },
          });
        } catch (error) {
          this.logger.warn(`New-error alert failed: ${(error as Error).message}`);
        }
      }
    }

    return { accepted: accepted.length, newGroups, groupIds: [...new Set(accepted.map((a) => a.groupId))] };
  }

  async groups(team: TeamContext, query: ErrorGroupsQueryDto) {
    if (query.projectId) await this.assertProject(team, query.projectId);
    const { skip, take, page, pageSize } = pagination(query.page, query.pageSize);
    const where: Prisma.ErrorGroupWhereInput = {
      project: {
        teamId: team.teamId,
        ...(query.projectId ? { id: query.projectId } : {}),
      },
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.environment ? { environment: query.environment } : {}),
      ...(query.search
        ? {
            OR: [
              { message: { contains: query.search, mode: 'insensitive' } },
              { errorType: { contains: query.search, mode: 'insensitive' } },
              { serviceName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.errorGroup.findMany({
        where,
        orderBy: { lastSeen: 'desc' },
        skip,
        take,
        include: { project: { select: { id: true, name: true, environment: true } } },
      }),
      this.prisma.errorGroup.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(team: TeamContext, groupId: string) {
    const group = await this.prisma.errorGroup.findFirst({
      where: { id: groupId, project: { teamId: team.teamId } },
      include: {
        project: { select: { id: true, name: true, environment: true } },
        events: { orderBy: { timestamp: 'desc' }, take: 50 },
      },
    });
    if (!group) throw new NotFoundException('Error group not found');
    return group;
  }

  async updateStatus(user: AuthenticatedUser, team: TeamContext, groupId: string, dto: UpdateErrorGroupDto) {
    const group = await this.prisma.errorGroup.findFirst({
      where: { id: groupId, project: { teamId: team.teamId } },
      select: { id: true, projectId: true, status: true },
    });
    if (!group) throw new NotFoundException('Error group not found');
    const updated = await this.prisma.errorGroup.update({
      where: { id: group.id },
      data: { status: dto.status },
      include: { project: { select: { id: true, name: true, environment: true } } },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: group.projectId,
      action: 'error_group.status_changed',
      resourceType: 'ErrorGroup',
      resourceId: group.id,
      metadata: { from: group.status, to: dto.status },
    });
    return updated;
  }

  async events(team: TeamContext, groupId: string, query: ErrorEventsQueryDto) {
    const group = await this.prisma.errorGroup.findFirst({
      where: { id: groupId, project: { teamId: team.teamId } },
      select: { id: true },
    });
    if (!group) throw new NotFoundException('Error group not found');
    const { skip, take, page, pageSize } = pagination(query.page, query.pageSize);
    const where = { errorGroupId: group.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.errorEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take,
      }),
      this.prisma.errorEvent.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async overview(team: TeamContext, projectId?: string) {
    if (projectId) await this.assertProject(team, projectId);
    const where = {
      project: {
        teamId: team.teamId,
        ...(projectId ? { id: projectId } : {}),
      },
    };
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [unresolvedGroups, totalEvents, events24h, severityGroups, recentEvents, topServices] =
      await Promise.all([
        this.prisma.errorGroup.count({ where: { ...where, status: ErrorStatus.UNRESOLVED } }),
        this.prisma.errorEvent.count({ where }),
        this.prisma.errorEvent.count({ where: { ...where, timestamp: { gte: since } } }),
        this.prisma.errorGroup.groupBy({
          by: ['severity'],
          where: { ...where, status: ErrorStatus.UNRESOLVED },
          _count: true,
          _sum: { eventCount: true },
        }),
        this.prisma.errorEvent.findMany({
          where: { ...where, timestamp: { gte: since } },
          select: { timestamp: true, errorGroupId: true, serviceName: true, errorType: true },
          orderBy: { timestamp: 'asc' },
          take: 20_000,
        }),
        this.prisma.errorGroup.groupBy({
          by: ['serviceName'],
          where: { ...where, status: ErrorStatus.UNRESOLVED },
          _sum: { eventCount: true },
          orderBy: { _sum: { eventCount: 'desc' } },
          take: 5,
        }),
      ]);
    const buckets = new Map<string, number>();
    for (const event of recentEvents) {
      const key = timeBucket(event.timestamp, 120);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const resolved = await this.prisma.errorGroup.count({ where: { ...where, status: 'RESOLVED' } });
    return {
      summary: {
        unresolvedGroups,
        totalEvents,
        events24h,
        resolvedGroups: resolved,
        resolutionRate: percent(resolved, unresolvedGroups + resolved),
      },
      severity: severityGroups.map((row) => ({
        severity: row.severity,
        groups: row._count,
        events: row._sum.eventCount ?? 0,
      })),
      topServices: topServices.map((row) => ({
        serviceName: row.serviceName,
        events: row._sum.eventCount ?? 0,
      })),
      timeline: [...buckets.entries()].map(([timestamp, count]) => ({ timestamp, count })),
    };
  }

  async sendTestError(
    user: AuthenticatedUser,
    team: TeamContext,
    projectId: string,
    url?: string,
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, teamId: team.teamId },
      select: { id: true, teamId: true, name: true, environment: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const target = url?.trim() ? url.trim().split('?')[0].slice(0, 300) : null;
    const message = target
      ? `Synthetic test error sent from the Outpost dashboard for ${target}`
      : 'Synthetic test error sent from the Outpost dashboard';

    const result = await this.ingestOne(
      project,
      {
        errorType: 'OutpostTestError',
        message,
        stackTrace: [
          `OutpostTestError: ${message}`,
          '    at sendTestError (/outpost/dashboard/errors)',
        ].join('\n'),
        serviceName: 'outpost-dashboard',
        environment: project.environment,
        httpStatus: 500,
        path: target ?? '/dashboard/errors',
        timestamp: new Date().toISOString(),
        metadata: { source: 'dashboard', synthetic: true },
      },
      undefined,
    );

    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: project.id,
      action: 'project.test_error_sent',
      resourceType: 'ErrorGroup',
      resourceId: result.groupId,
      metadata: { fingerprint: result.fingerprint, synthetic: true },
    });

    return {
      accepted: 1,
      newGroups: result.isNew ? 1 : 0,
      groupId: result.groupId,
      fingerprint: result.fingerprint,
    };
  }

  private async ingestOne(
    project: { id: string; teamId: string; name: string; environment: Environment },
    event: IngestErrorEventDto,
    serviceId: string | undefined,
  ): Promise<{ id: string; groupId: string; fingerprint: string; isNew: boolean; errorType: string; environment: Environment }> {
    let environment: Environment;
    try {
      environment = normalizeEnvironment(event.environment);
    } catch {
      throw new BadRequestException('environment must be one of production, staging, development, or test');
    }
    const timestamp = this.normalizeTimestamp(event.timestamp);
    const stackTrace = sanitizeStackTrace(event.stackTrace);
    const message = this.sanitizeMessage(event.message);
    const errorType = this.sanitizeShort(event.errorType);
    const serviceName = this.sanitizeShort(event.serviceName);
    const fingerprint = fingerprintError({ serviceName, errorType, message, environment });
    const severity = event.severity ?? deriveSeverity(event.httpStatus);
    const metadata = sanitizeMetadata(event.metadata);
    const path = event.path ? event.path.split('?')[0].slice(0, 300) : null;

    const persist = async () => {
      const existing = await this.prisma.errorGroup.findUnique({
        where: { projectId_fingerprint: { projectId: project.id, fingerprint } },
      });
      let group = existing;
      let isNew = false;
      if (!group) {
        try {
          group = await this.prisma.errorGroup.create({
            data: {
              projectId: project.id,
              fingerprint,
              errorType,
              message,
              serviceName,
              environment,
              severity,
              firstSeen: timestamp,
              lastSeen: timestamp,
              eventCount: 1,
              stackSample: stackTrace,
            },
          });
          isNew = true;
        } catch (error) {
          if ((error as { code?: string }).code === 'P2002') {
            group = await this.prisma.errorGroup.findUnique({
              where: { projectId_fingerprint: { projectId: project.id, fingerprint } },
            });
          } else {
            throw error;
          }
        }
      }
      if (!group) throw new Error('Unable to create or resolve error group');
      if (!isNew) {
        group = await this.prisma.errorGroup.update({
          where: { id: group.id },
          data: {
            eventCount: { increment: 1 },
            lastSeen: timestamp > group.lastSeen ? timestamp : group.lastSeen,
            severity,
            status: group.status === ErrorStatus.RESOLVED ? ErrorStatus.UNRESOLVED : group.status,
            stackSample: group.stackSample ?? stackTrace,
          },
        });
      }
      const createdEvent = await this.prisma.errorEvent.create({
        data: {
          projectId: project.id,
          errorGroupId: group.id,
          serviceId: serviceId ?? null,
          fingerprint,
          errorType,
          message,
          stackTrace,
          serviceName,
          environment,
          httpStatus: event.httpStatus ?? null,
          path,
          metadata: (metadata ?? {}) as Prisma.InputJsonValue,
          timestamp,
        },
      });
      return { id: createdEvent.id, groupId: group.id, fingerprint, isNew, errorType, environment };
    };

    const result = await persist();
    return result;
  }

  private normalizeTimestamp(value: string | undefined): Date {
    if (!value) return new Date();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return new Date();
    const now = Date.now();
    if (date.getTime() > now + 5 * 60_000) return new Date();
    if (date.getTime() < now - 30 * 24 * 60 * 60_000) return new Date();
    return date;
  }

  private sanitizeShort(value: string): string {
    return value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
  }

  private sanitizeMessage(value: string): string {
    const cleaned = redactSecrets(
      value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''),
      2000,
    );
    return cleaned ?? 'Unknown error';
  }

  private checkRateLimit(projectId: string): void {
    const limit = Number(process.env.INGEST_RATE_LIMIT_PER_MINUTE ?? 120);
    const now = Date.now();
    const window = this.ingestionWindows.get(projectId);
    if (!window || now - window.start > 60_000) {
      this.ingestionWindows.set(projectId, { start: now, count: 1 });
      return;
    }
    window.count += 1;
    if (window.count > limit) {
      throw new HttpException(
        'Ingestion rate limit exceeded for this project',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async assertProject(team: TeamContext, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, teamId: team.teamId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
  }
}
