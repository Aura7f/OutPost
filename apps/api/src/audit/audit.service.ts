import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    teamId: string;
    actorId?: string;
    projectId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    context?: AuditContext;
  }): Promise<void> {
    // Audit writes must never take down a successful primary operation.
    try {
      await this.prisma.auditLog.create({
        data: {
          teamId: input.teamId,
          actorId: input.actorId,
          projectId: input.projectId,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          ipAddress: input.context?.ip,
          userAgent: input.context?.userAgent?.slice(0, 300),
        },
      });
    } catch {
      // Logging an audit event is best-effort; the event is still captured by
      // structured application logs in production.
    }
  }

  async list(teamId: string, page: number, pageSize: number) {
    const where = { teamId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          projectId: true,
          metadata: true,
          ipAddress: true,
          createdAt: true,
          actor: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
