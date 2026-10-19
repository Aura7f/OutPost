import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ReportFrequency,
  ReportStatus,
  ReportType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { shellEmail } from '../notifications/email.service';
import { ReportBuilderService, type ReportSnapshot } from './report-builder.service';
import { ReportPdfService } from './report-pdf.service';
import { generateToken, redactSecrets, sha256 } from '../common/crypto';
import { escapeHtml, pagination } from '../common/utils';
import type { AuthenticatedUser, TeamContext } from '../common/types';
import type {
  CreateReportDto,
  CreateReportScheduleDto,
  EmailReportDto,
  ReportsQueryDto,
  UpdateReportScheduleDto,
} from './reports.dto';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: ReportBuilderService,
    private readonly pdf: ReportPdfService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async create(user: AuthenticatedUser, team: TeamContext, dto: CreateReportDto) {
    const project = await this.assertProject(team, dto.projectId);
    const period = this.resolvePeriod(dto);
    const name = dto.name?.trim() || `${project.name} ${this.typeLabel(dto.type)}`;
    const report = await this.generate({
      teamId: team.teamId,
      projectId: project.id,
      projectName: project.name,
      type: dto.type,
      name,
      periodStart: period.start,
      periodEnd: period.end,
      createdById: user.profileId,
      emailRecipients: [...new Set((dto.emailRecipients ?? []).map((email) => email.toLowerCase()))],
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: project.id,
      action: 'report.created',
      resourceType: 'Report',
      resourceId: report.id,
      metadata: { type: dto.type, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString() },
    });
    return this.publicReport(report);
  }

  async list(team: TeamContext, query: ReportsQueryDto) {
    if (query.projectId) await this.assertProject(team, query.projectId);
    const { skip, take, page, pageSize } = pagination(query.page, query.pageSize);
    const where = {
      project: {
        teamId: team.teamId,
        ...(query.projectId ? { id: query.projectId } : {}),
      },
      ...(query.type ? { type: query.type } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          sizeBytes: true,
          generatedAt: true,
          createdAt: true,
          error: true,
          emailRecipients: true,
          createdBy: { select: { id: true, fullName: true, email: true } },
          project: { select: { id: true, name: true, environment: true } },
          _count: { select: { shares: true } },
        },
      }),
      this.prisma.report.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(team: TeamContext, reportId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, project: { teamId: team.teamId } },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        snapshot: true,
        sizeBytes: true,
        emailRecipients: true,
        error: true,
        generatedAt: true,
        createdAt: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        project: { select: { id: true, name: true, environment: true } },
        shares: {
          where: { revokedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            tokenPrefix: true,
            expiresAt: true,
            revokedAt: true,
            viewCount: true,
            lastViewedAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  async download(team: TeamContext, reportId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, project: { teamId: team.teamId } },
      select: { id: true, name: true, content: true, status: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.COMPLETED || !report.content) {
      throw new BadRequestException('Report PDF is not available yet');
    }
    return {
      name: report.name,
      buffer: Buffer.from(report.content),
      filename: this.safeFilename(report.name),
    };
  }

  async emailReport(user: AuthenticatedUser, team: TeamContext, reportId: string, dto: EmailReportDto) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, project: { teamId: team.teamId } },
      include: { project: { select: { id: true, name: true, teamId: true } } },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.COMPLETED) {
      throw new BadRequestException('Only completed reports can be emailed');
    }
    const recipients = [...new Set(dto.recipients.map((email) => email.toLowerCase()))];
    await this.sendReportEmail(report, recipients, report.project.name, report.project.teamId);
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: report.projectId,
      action: 'report.emailed',
      resourceType: 'Report',
      resourceId: report.id,
      metadata: { recipientCount: recipients.length },
    });
    return { queued: recipients.length };
  }

  async createShare(user: AuthenticatedUser, team: TeamContext, reportId: string, expiresInDays = 7) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, project: { teamId: team.teamId } },
      select: { id: true, name: true, status: true, projectId: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.COMPLETED) {
      throw new BadRequestException('Only completed reports can be shared');
    }
    const activeShares = await this.prisma.reportShare.count({
      where: { reportId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (activeShares >= 20) {
      throw new BadRequestException('Revoke an existing share link before creating another');
    }
    const token = generateToken('rshare');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const share = await this.prisma.reportShare.create({
      data: {
        reportId,
        createdById: user.profileId,
        tokenHash: sha256(token),
        tokenPrefix: token.slice(0, 12),
        expiresAt,
      },
      select: {
        id: true,
        tokenPrefix: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: report.projectId,
      action: 'report.share_created',
      resourceType: 'ReportShare',
      resourceId: share.id,
      metadata: { expiresAt: expiresAt.toISOString() },
    });
    return {
      ...share,
      url: `${this.webUrl()}/share/reports/${token}`,
      token,
    };
  }

  async shares(team: TeamContext, reportId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, project: { teamId: team.teamId } },
      select: { id: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    return this.prisma.reportShare.findMany({
      where: { reportId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tokenPrefix: true,
        expiresAt: true,
        revokedAt: true,
        viewCount: true,
        lastViewedAt: true,
        createdAt: true,
        createdBy: { select: { fullName: true, email: true } },
      },
    });
  }

  async revokeShare(user: AuthenticatedUser, team: TeamContext, reportId: string, shareId: string) {
    const share = await this.prisma.reportShare.findFirst({
      where: { id: shareId, reportId, report: { project: { teamId: team.teamId } } },
      include: { report: { select: { projectId: true } } },
    });
    if (!share) throw new NotFoundException('Share link not found');
    if (share.revokedAt) return { revoked: true };
    await this.prisma.reportShare.update({
      where: { id: share.id },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: share.report.projectId,
      action: 'report.share_revoked',
      resourceType: 'ReportShare',
      resourceId: share.id,
    });
    return { revoked: true };
  }

  async resolvePublicShare(token: string, increment = true) {
    if (!token || token.length > 200) throw new NotFoundException('Report link not found');
    const share = await this.prisma.reportShare.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        report: {
          include: { project: { select: { name: true, environment: true } } },
        },
      },
    });
    if (!share || share.revokedAt) throw new NotFoundException('Report link not found or has been revoked');
    if (share.expiresAt && share.expiresAt < new Date()) {
      throw new NotFoundException('This report link has expired');
    }
    if (share.report.status !== ReportStatus.COMPLETED || !share.report.snapshot) {
      throw new NotFoundException('Report is not available');
    }
    if (increment) {
      await this.prisma.reportShare.update({
        where: { id: share.id },
        data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
      });
    }
    return {
      share: { expiresAt: share.expiresAt, createdAt: share.createdAt },
      report: {
        name: share.report.name,
        type: share.report.type,
        periodStart: share.report.periodStart,
        periodEnd: share.report.periodEnd,
        generatedAt: share.report.generatedAt,
      },
      project: {
        name: share.report.project.name,
        environment: share.report.project.environment,
      },
      snapshot: share.report.snapshot as unknown as ReportSnapshot,
    };
  }

  async publicPdf(token: string) {
    if (!token || token.length > 200) throw new NotFoundException('Report link not found');
    const share = await this.prisma.reportShare.findUnique({
      where: { tokenHash: sha256(token) },
      include: { report: { select: { content: true, name: true, status: true } } },
    });
    if (
      !share ||
      share.revokedAt ||
      (share.expiresAt && share.expiresAt < new Date()) ||
      share.report.status !== ReportStatus.COMPLETED ||
      !share.report.content
    ) {
      throw new NotFoundException('Report link not found or unavailable');
    }
    await this.prisma.reportShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
    return {
      name: share.report.name,
      buffer: Buffer.from(share.report.content),
      filename: this.safeFilename(share.report.name),
    };
  }

  async schedules(team: TeamContext, projectId?: string) {
    if (projectId) await this.assertProject(team, projectId);
    return this.prisma.reportSchedule.findMany({
      where: {
        project: { teamId: team.teamId, ...(projectId ? { id: projectId } : {}) },
      },
      include: { project: { select: { id: true, name: true, environment: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSchedule(user: AuthenticatedUser, team: TeamContext, dto: CreateReportScheduleDto) {
    const project = await this.assertProject(team, dto.projectId);
    const schedule = await this.prisma.reportSchedule.create({
      data: {
        projectId: project.id,
        name: dto.name.trim(),
        frequency: dto.frequency,
        recipients: [...new Set(dto.recipients.map((email) => email.toLowerCase()))],
        enabled: dto.enabled ?? true,
        nextRunAt: this.nextScheduledTime(dto.frequency, new Date()),
      },
      include: { project: { select: { id: true, name: true, environment: true } } },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: project.id,
      action: 'report_schedule.created',
      resourceType: 'ReportSchedule',
      resourceId: schedule.id,
      metadata: { frequency: schedule.frequency },
    });
    return schedule;
  }

  async updateSchedule(
    user: AuthenticatedUser,
    team: TeamContext,
    scheduleId: string,
    dto: UpdateReportScheduleDto,
  ) {
    const schedule = await this.prisma.reportSchedule.findFirst({
      where: { id: scheduleId, project: { teamId: team.teamId } },
    });
    if (!schedule) throw new NotFoundException('Report schedule not found');
    const updated = await this.prisma.reportSchedule.update({
      where: { id: schedule.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.frequency !== undefined ? { frequency: dto.frequency } : {}),
        ...(dto.recipients !== undefined
          ? { recipients: [...new Set(dto.recipients.map((email) => email.toLowerCase()))] }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.frequency !== undefined
          ? { nextRunAt: this.nextScheduledTime(dto.frequency, new Date()) }
          : dto.enabled === true
            ? { nextRunAt: this.nextScheduledTime(schedule.frequency, new Date()) }
            : {}),
      },
      include: { project: { select: { id: true, name: true, environment: true } } },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: schedule.projectId,
      action: 'report_schedule.updated',
      resourceType: 'ReportSchedule',
      resourceId: schedule.id,
    });
    return updated;
  }

  async deleteSchedule(user: AuthenticatedUser, team: TeamContext, scheduleId: string) {
    const schedule = await this.prisma.reportSchedule.findFirst({
      where: { id: scheduleId, project: { teamId: team.teamId } },
    });
    if (!schedule) throw new NotFoundException('Report schedule not found');
    await this.prisma.reportSchedule.delete({ where: { id: schedule.id } });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: schedule.projectId,
      action: 'report_schedule.deleted',
      resourceType: 'ReportSchedule',
      resourceId: schedule.id,
    });
    return { deleted: true };
  }

  /** Called by the durable scheduler. Claims each due schedule atomically. */
  async processSchedules(limit = 10): Promise<{ processed: number }> {
    const due = await this.prisma.reportSchedule.findMany({
      where: { enabled: true, nextRunAt: { lte: new Date() } },
      include: {
        project: {
          select: { id: true, name: true, teamId: true },
        },
      },
      take: limit,
      orderBy: { nextRunAt: 'asc' },
    });
    let processed = 0;
    for (const schedule of due) {
      const now = new Date();
      const nextRunAt = this.nextScheduledTime(schedule.frequency, now);
      const claimed = await this.prisma.reportSchedule.updateMany({
        where: { id: schedule.id, enabled: true, nextRunAt: schedule.nextRunAt },
        data: { nextRunAt, lastRunAt: now },
      });
      if (claimed.count === 0) continue;
      try {
        const type =
          schedule.frequency === ReportFrequency.DAILY
            ? ReportType.DAILY
            : schedule.frequency === ReportFrequency.WEEKLY
              ? ReportType.WEEKLY
              : ReportType.MONTHLY;
        const { start, end } = this.scheduledPeriod(type, now);
        const project = await this.prisma.project.findFirst({
          where: { id: schedule.projectId, teamId: schedule.project.teamId },
          select: { id: true, name: true, teamId: true },
        });
        if (!project) continue;
        await this.generate({
          teamId: project.teamId,
          projectId: project.id,
          projectName: project.name,
          type,
          name: `${schedule.name} · ${now.toISOString().slice(0, 10)}`,
          periodStart: start,
          periodEnd: end,
          createdById: null,
          emailRecipients: schedule.recipients,
        });
        processed += 1;
      } catch (error) {
        this.logger.error(`Scheduled report ${schedule.id} failed: ${(error as Error).message}`);
      }
    }
    return { processed };
  }

  /** Durable scheduled-report execution. The scheduler claims and advances the schedule. */
  async generateFromSchedule(scheduleId: string, jobId: string, dueAt?: Date) {
    const schedule = await this.prisma.reportSchedule.findUnique({
      where: { id: scheduleId },
      include: { project: { select: { id: true, name: true, teamId: true } } },
    });
    if (!schedule) throw new NotFoundException('Report schedule not found');
    if (!schedule.enabled) return { skipped: true, reason: 'schedule_disabled' };
    const existing = await this.prisma.report.findUnique({ where: { jobId } });
    if (existing?.status === ReportStatus.COMPLETED) return existing;
    const end = dueAt ?? new Date();
    const start = new Date(end);
    if (schedule.frequency === ReportFrequency.DAILY) start.setUTCDate(start.getUTCDate() - 1);
    else if (schedule.frequency === ReportFrequency.WEEKLY) start.setUTCDate(start.getUTCDate() - 7);
    else start.setUTCDate(start.getUTCDate() - 30);
    const type =
      schedule.frequency === ReportFrequency.DAILY
        ? ReportType.DAILY
        : schedule.frequency === ReportFrequency.WEEKLY
          ? ReportType.WEEKLY
          : ReportType.MONTHLY;
    const report = await this.generate({
      teamId: schedule.project.teamId,
      projectId: schedule.project.id,
      projectName: schedule.project.name,
      type,
      name: `${schedule.name} · ${end.toISOString().slice(0, 10)}`,
      periodStart: start,
      periodEnd: end,
      createdById: null,
      emailRecipients: schedule.recipients,
      jobId,
    });
    await this.prisma.reportSchedule
      .update({ where: { id: schedule.id }, data: { lastRunAt: new Date() } })
      .catch(() => undefined);
    return report;
  }

  private async generate(input: {
    teamId: string;
    projectId: string;
    projectName: string;
    type: ReportType;
    name: string;
    periodStart: Date;
    periodEnd: Date;
    createdById: string | null;
    emailRecipients: string[];
    jobId?: string;
  }) {
    let report = input.jobId
      ? await this.prisma.report.findUnique({ where: { jobId: input.jobId } })
      : null;
    if (report?.status === ReportStatus.COMPLETED) return report;
    if (report) {
      report = await this.prisma.report.update({
        where: { id: report.id },
        data: { status: ReportStatus.GENERATING, error: null },
      });
    } else {
      report = await this.prisma.report.create({
        data: {
          projectId: input.projectId,
          createdById: input.createdById,
          jobId: input.jobId,
          type: input.type,
          name: input.name.slice(0, 100),
          status: ReportStatus.GENERATING,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          emailRecipients: input.emailRecipients,
        },
      });
    }
    try {
      const snapshot = await this.builder.build({
        projectId: input.projectId,
        teamId: input.teamId,
        start: input.periodStart,
        end: input.periodEnd,
      });
      const pdf = await this.pdf.render(snapshot, report.name, false);
      const completed = await this.prisma.report.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.COMPLETED,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          content: pdf,
          sizeBytes: pdf.length,
          generatedAt: new Date(),
          error: null,
        },
      });
      if (input.emailRecipients.length > 0) {
        await this.sendReportEmail(completed, input.emailRecipients, input.projectName, input.teamId);
      }
      return completed;
    } catch (error) {
      const message = redactSecrets((error as Error).message, 500) ?? 'Report generation failed';
      await this.prisma.report.update({
        where: { id: report.id },
        data: { status: ReportStatus.FAILED, error: message },
      }).catch(() => undefined);
      this.logger.error(`Report ${report.id} failed: ${message}`);
      throw new InternalServerErrorException('Report generation failed. Check monitoring data and try again.');
    }
  }

  private async sendReportEmail(
    report: { id: string; name: string; periodStart: Date; periodEnd: Date; type: ReportType },
    recipients: string[],
    projectName: string,
    teamId: string,
  ) {
    const html = shellEmail(`
      <p style="margin:0 0 10px;color:#7da889;font-size:11px;font-weight:700;letter-spacing:.14em;">MONITORING REPORT</p>
      <h1 style="margin:0 0 12px;color:#f2f3ed;font-size:22px;letter-spacing:-.02em;">${escapeHtml(report.name)}</h1>
      <p style="margin:0 0 20px;color:#b4b9ae;font-size:14px;line-height:1.7;">Your ${escapeHtml(report.type.toLowerCase())} report for <strong>${escapeHtml(projectName)}</strong> is attached as a PDF.</p>
      <table style="font-size:13px;color:#b4b9ae;margin-bottom:22px;">
        <tr><td style="padding:4px 12px 4px 0;color:#777e72;">Period</td><td>${escapeHtml(report.periodStart.toUTCString())} — ${escapeHtml(report.periodEnd.toUTCString())}</td></tr>
      </table>
      <a href="${this.webUrl()}/reports" style="display:inline-block;background:#dfe4d4;color:#171915;text-decoration:none;padding:11px 18px;border-radius:6px;font-size:13px;font-weight:600;">View reports</a>
      <p style="margin:22px 0 0;color:#6f776a;font-size:11px;line-height:1.6;">Reports contain aggregate monitoring data and exclude credentials, raw SQL, request bodies, and complete stack traces.</p>
    `);
    for (const recipient of recipients) {
      try {
        await this.notifications.enqueueAndSend({
          teamId,
          recipient,
          subject: `[Outpost] ${report.name}`,
          html,
          text: `Your monitoring report ${report.name} is attached.`,
          reportId: report.id,
        });
      } catch (error) {
        this.logger.warn(`Unable to queue report email to ${recipient}: ${(error as Error).message}`);
      }
    }
  }

  private resolvePeriod(dto: CreateReportDto): { start: Date; end: Date } {
    if ((dto.periodStart && !dto.periodEnd) || (!dto.periodStart && dto.periodEnd)) {
      throw new BadRequestException('Both periodStart and periodEnd are required');
    }
    let start: Date;
    let end: Date;
    if (dto.periodStart && dto.periodEnd) {
      start = new Date(dto.periodStart);
      end = new Date(dto.periodEnd);
    } else {
      end = new Date();
      const days = dto.type === ReportType.DAILY ? 1 : dto.type === ReportType.WEEKLY ? 7 : 30;
      start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    }
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid report period');
    }
    if (start >= end) throw new BadRequestException('Report period start must be before end');
    if (end.getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException('Report period cannot end in the future');
    }
    if (end.getTime() - start.getTime() > 365 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Report periods are limited to 365 days');
    }
    return { start, end };
  }

  private scheduledPeriod(type: ReportType, now: Date): { start: Date; end: Date } {
    const end = new Date(now);
    const start = new Date(now);
    if (type === ReportType.DAILY) start.setUTCDate(start.getUTCDate() - 1);
    else if (type === ReportType.WEEKLY) start.setUTCDate(start.getUTCDate() - 7);
    else start.setUTCDate(start.getUTCDate() - 30);
    return { start, end };
  }

  private nextScheduledTime(frequency: ReportFrequency, after: Date): Date {
    const next = new Date(after);
    next.setUTCHours(8, 0, 0, 0);
    if (frequency === ReportFrequency.DAILY) {
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    }
    if (frequency === ReportFrequency.WEEKLY) {
      const daysUntilMonday = ((8 - next.getUTCDay()) % 7) || 7;
      next.setUTCDate(next.getUTCDate() + daysUntilMonday);
      return next;
    }
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  private async assertProject(team: TeamContext, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, teamId: team.teamId },
      select: { id: true, name: true, teamId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private publicReport(report: Awaited<ReturnType<ReportsService['generate']>>) {
    const { content, snapshot, ...safe } = report;
    return safe;
  }

  private safeFilename(name: string): string {
    return `${name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'outpost-report'}.pdf`;
  }

  private webUrl(): string {
    return this.config.get<string>('WEB_URL', 'http://localhost:5173').replace(/\/+$/, '');
  }

  private typeLabel(type: ReportType): string {
    switch (type) {
      case ReportType.DAILY:
        return 'daily report';
      case ReportType.WEEKLY:
        return 'weekly report';
      case ReportType.MONTHLY:
        return 'monthly report';
      default:
        return 'monitoring report';
    }
  }
}
