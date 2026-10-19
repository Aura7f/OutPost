import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { pagination, parseDate } from '../common/utils';
import type { AuthenticatedUser, TeamContext } from '../common/types';
import type { IncidentQueryDto } from './incidents.dto';

export interface OpenIncidentInput {
  projectId: string;
  type: IncidentType;
  severity?: IncidentSeverity;
  title: string;
  summary: string;
  monitorId?: string;
  integrationId?: string;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(team: TeamContext, query: IncidentQueryDto) {
    const { skip, take, page, pageSize } = pagination(query.page, query.pageSize);
    const where: Prisma.IncidentWhereInput = {
      project: { teamId: team.teamId },
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            startedAt: {
              ...(query.from ? { gte: parseDate(query.from, new Date(0)) } : {}),
              ...(query.to ? { lte: parseDate(query.to, new Date()) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.incident.findMany({
        where,
        orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
        skip,
        take,
        include: {
          project: { select: { id: true, name: true, environment: true } },
          monitor: { select: { id: true, name: true, url: true } },
          integration: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.incident.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(team: TeamContext, incidentId: string) {
    const incident = await this.prisma.incident.findFirst({
      where: { id: incidentId, project: { teamId: team.teamId } },
      include: {
        project: { select: { id: true, name: true, environment: true } },
        monitor: { select: { id: true, name: true, url: true, method: true } },
        integration: { select: { id: true, name: true, type: true } },
      },
    });
    if (!incident) throw new NotFoundException('Incident not found');
    return incident;
  }

  async acknowledge(user: AuthenticatedUser, team: TeamContext, incidentId: string) {
    const incident = await this.get(team, incidentId);
    if (incident.status === IncidentStatus.RESOLVED) {
      throw new BadRequestException('Resolved incidents cannot be acknowledged');
    }
    if (incident.status === IncidentStatus.ACKNOWLEDGED) return incident;
    const updated = await this.prisma.incident.update({
      where: { id: incident.id },
      data: {
        status: IncidentStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        acknowledgedById: user.profileId,
      },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: incident.projectId,
      action: 'incident.acknowledged',
      resourceType: 'Incident',
      resourceId: incident.id,
    });
    return updated;
  }

  async resolve(user: AuthenticatedUser, team: TeamContext, incidentId: string, note?: string) {
    const incident = await this.get(team, incidentId);
    if (incident.status === IncidentStatus.RESOLVED) return incident;
    const metadata = {
      ...((incident.metadata as Record<string, unknown>) ?? {}),
      ...(note ? { resolutionNote: note.slice(0, 1000), resolvedBy: user.email } : {}),
    };
    const updated = await this.prisma.incident.update({
      where: { id: incident.id },
      data: {
        status: IncidentStatus.RESOLVED,
        resolvedAt: new Date(),
        // Allow a future incident with the same dedupe key.
        dedupeKey: null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: incident.projectId,
      action: 'incident.resolved',
      resourceType: 'Incident',
      resourceId: incident.id,
      metadata: { note: note?.slice(0, 300) },
    });
    return updated;
  }

  async summary(team: TeamContext, projectId?: string) {
    const where = {
      project: { teamId: team.teamId },
      ...(projectId ? { projectId } : {}),
    };
    const [open, acknowledged, resolved24h, critical] = await this.prisma.$transaction([
      this.prisma.incident.count({ where: { ...where, status: IncidentStatus.OPEN } }),
      this.prisma.incident.count({ where: { ...where, status: IncidentStatus.ACKNOWLEDGED } }),
      this.prisma.incident.count({
        where: {
          ...where,
          status: IncidentStatus.RESOLVED,
          resolvedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.incident.count({
        where: {
          ...where,
          status: { in: [IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED] },
          severity: IncidentSeverity.CRITICAL,
        },
      }),
    ]);
    return { open, acknowledged, resolved24h, critical };
  }

  /**
   * Called by monitoring workers. PostgreSQL's unique dedupeKey plus this
   * reopen logic prevent duplicate active incidents.
   */
  async open(input: OpenIncidentInput) {
    if (input.dedupeKey) {
      const existing = await this.prisma.incident.findUnique({
        where: { dedupeKey: input.dedupeKey },
      });
      if (existing) {
        if (existing.status !== IncidentStatus.RESOLVED) return existing;
        return this.prisma.incident.update({
          where: { id: existing.id },
          data: {
            status: IncidentStatus.OPEN,
            severity: input.severity ?? IncidentSeverity.HIGH,
            title: input.title,
            summary: input.summary,
            startedAt: new Date(),
            acknowledgedAt: null,
            acknowledgedById: null,
            resolvedAt: null,
            metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          },
        });
      }
    }
    return this.prisma.incident.create({
      data: {
        projectId: input.projectId,
        monitorId: input.monitorId,
        integrationId: input.integrationId,
        type: input.type,
        severity: input.severity ?? IncidentSeverity.HIGH,
        title: input.title.slice(0, 200),
        summary: input.summary.slice(0, 2000),
        dedupeKey: input.dedupeKey,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async resolveByDedupeKey(dedupeKey: string): Promise<{ id: string; projectId: string; title: string } | null> {
    const existing = await this.prisma.incident.findUnique({ where: { dedupeKey } });
    if (!existing || existing.status === IncidentStatus.RESOLVED) return null;
    const updated = await this.prisma.incident.update({
      where: { id: existing.id },
      data: { status: IncidentStatus.RESOLVED, resolvedAt: new Date(), dedupeKey: null },
      select: { id: true, projectId: true, title: true },
    });
    return updated;
  }
}
