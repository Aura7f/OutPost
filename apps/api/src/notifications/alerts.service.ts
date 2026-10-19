import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AlertEventType, NotificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService, shellEmail } from './email.service';
import { NotificationService } from './notification.service';
import { escapeHtml, pagination } from '../common/utils';
import type { AuthenticatedUser, TeamContext } from '../common/types';
import type {
  CreateAlertRuleDto,
  CreateChannelDto,
  TestAlertDto,
  UpdateAlertRuleDto,
  UpdateChannelDto,
} from './alerts.dto';

export interface AlertContext {
  teamId: string;
  projectId: string;
  projectName: string;
  event: AlertEventType;
  title: string;
  summary: string;
  severity?: string;
  monitorName?: string;
  serviceName?: string;
  incidentId?: string;
  dashboardPath?: string;
  latencyMs?: number;
  failureCount?: number;
}

const FAILURE_EVENTS: AlertEventType[] = [
  AlertEventType.DOWNTIME,
  AlertEventType.HEARTBEAT_FAILURE,
  AlertEventType.DATABASE_CONNECTION_FAILURE,
];

const EVENT_LABELS: Record<AlertEventType, string> = {
  DOWNTIME: 'Endpoint down',
  RECOVERY: 'Service recovered',
  HIGH_LATENCY: 'High latency',
  DATABASE_CONNECTION_FAILURE: 'Database connection failure',
  HEARTBEAT_FAILURE: 'Heartbeat failure',
  NEW_ERROR: 'New application error',
  INCIDENT_CREATED: 'Incident opened',
};

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  async evaluate(context: AlertContext): Promise<{ triggered: boolean; reason?: string }> {
    const rule = await this.prisma.alertRule.findUnique({
      where: { projectId_type: { projectId: context.projectId, type: context.event } },
    });
    if (!rule || !rule.enabled) return { triggered: false, reason: 'rule_disabled' };
    if (context.event === AlertEventType.HIGH_LATENCY && context.latencyMs !== undefined) {
      if (rule.latencyThresholdMs !== null && context.latencyMs <= rule.latencyThresholdMs) {
        return { triggered: false, reason: 'below_latency_threshold' };
      }
    }
    if (
      context.failureCount !== undefined &&
      FAILURE_EVENTS.includes(context.event) &&
      context.failureCount < rule.failureThreshold
    ) {
      return { triggered: false, reason: 'below_failure_threshold' };
    }

    const now = new Date();
    if (context.event !== AlertEventType.RECOVERY && rule.lastTriggeredAt) {
      const cooldownEnds = new Date(rule.lastTriggeredAt.getTime() + rule.cooldownMinutes * 60_000);
      if (cooldownEnds > now) return { triggered: false, reason: 'cooldown' };
    }

    const channels = await this.prisma.notificationChannel.findMany({
      where: { teamId: context.teamId, enabled: true, type: 'EMAIL' },
      select: { id: true, config: true },
    });
    const channelEmails: Array<{ email: string; channelId: string }> = [];
    for (const channel of channels) {
      const emails = (channel.config as { emails?: unknown })?.emails;
      if (Array.isArray(emails)) {
        for (const email of emails) {
          if (typeof email === 'string' && email.includes('@')) {
            channelEmails.push({ email: email.toLowerCase(), channelId: channel.id });
          }
        }
      }
    }
    const ruleRecipients = rule.recipients.map((email) => email.toLowerCase()).filter(Boolean);
    const recipients = [...new Set([...ruleRecipients, ...channelEmails.map((c) => c.email)])];
    if (recipients.length === 0) return { triggered: false, reason: 'no_recipients' };

    // Atomically claim this alert. Multiple dispatchers can't send the same
    // alert simultaneously because only one update can satisfy the cooldown.
    const claimed = await this.prisma.alertRule.updateMany({
      where: {
        id: rule.id,
        enabled: true,
        ...(context.event === AlertEventType.RECOVERY
          ? {}
          : {
              OR: [
                { lastTriggeredAt: null },
                { lastTriggeredAt: { lte: new Date(now.getTime() - rule.cooldownMinutes * 60_000) } },
              ],
            }),
      },
      data: { lastTriggeredAt: now },
    });
    if (claimed.count === 0) return { triggered: false, reason: 'cooldown' };

    const html = this.buildHtml(context);
    const text = this.buildText(context);
    const subject = `[Outpost] ${EVENT_LABELS[context.event]} · ${context.projectName}`;
    const channelByEmail = new Map(channelEmails.map((channel) => [channel.email, channel.channelId]));

    await Promise.allSettled(
      recipients.map((recipient) =>
        this.notification.enqueueAndSend({
          teamId: context.teamId,
          recipient,
          subject,
          html,
          text,
          alertRuleId: rule.id,
          incidentId: context.incidentId,
          channelId: channelByEmail.get(recipient),
        }),
      ),
    );
    return { triggered: true };
  }

  async listRules(team: TeamContext, projectId?: string) {
    if (projectId) await this.assertProject(team, projectId);
    return this.prisma.alertRule.findMany({
      where: {
        project: { teamId: team.teamId },
        ...(projectId ? { projectId } : {}),
      },
      orderBy: [{ projectId: 'asc' }, { type: 'asc' }],
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async createRule(user: AuthenticatedUser, team: TeamContext, dto: CreateAlertRuleDto) {
    await this.assertProject(team, dto.projectId);
    const rule = await this.prisma.alertRule.create({
      data: {
        projectId: dto.projectId,
        type: dto.type,
        enabled: dto.enabled ?? true,
        recipients: dto.recipients ?? [],
        cooldownMinutes: dto.cooldownMinutes ?? 30,
        failureThreshold: dto.failureThreshold ?? 3,
        latencyThresholdMs: dto.latencyThresholdMs ?? 2000,
      },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: dto.projectId,
      action: 'alert_rule.created',
      resourceType: 'AlertRule',
      resourceId: rule.id,
      metadata: { type: rule.type },
    });
    return rule;
  }

  async updateRule(user: AuthenticatedUser, team: TeamContext, ruleId: string, dto: UpdateAlertRuleDto) {
    const rule = await this.prisma.alertRule.findFirst({
      where: { id: ruleId, project: { teamId: team.teamId } },
    });
    if (!rule) throw new NotFoundException('Alert rule not found');
    const updated = await this.prisma.alertRule.update({
      where: { id: rule.id },
      data: {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.recipients !== undefined
          ? { recipients: [...new Set(dto.recipients.map((e) => e.toLowerCase()))] }
          : {}),
        ...(dto.cooldownMinutes !== undefined ? { cooldownMinutes: dto.cooldownMinutes } : {}),
        ...(dto.failureThreshold !== undefined ? { failureThreshold: dto.failureThreshold } : {}),
        ...(dto.latencyThresholdMs !== undefined ? { latencyThresholdMs: dto.latencyThresholdMs } : {}),
      },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: rule.projectId,
      action: 'alert_rule.updated',
      resourceType: 'AlertRule',
      resourceId: rule.id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async test(user: AuthenticatedUser, team: TeamContext, dto: TestAlertDto) {
    const project = await this.assertProject(team, dto.projectId);
    const html = shellEmail(`
      <p style="margin:0 0 12px;color:#d8a54a;font-size:12px;font-weight:600;letter-spacing:.12em;">TEST NOTIFICATION</p>
      <h1 style="margin:0 0 12px;color:#f2f3ed;font-size:22px;">Alert delivery is working</h1>
      <p style="margin:0;color:#b4b9ae;font-size:14px;line-height:1.7;">This test confirms that Outpost can deliver alerts for <strong>${escapeHtml(project.name)}</strong>.</p>
    `);
    const delivery = await this.notification.enqueueAndSend({
      teamId: team.teamId,
      recipient: dto.recipient,
      subject: `[Outpost] Test alert · ${project.name}`,
      html,
      text: `Test alert for ${project.name}`,
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      projectId: project.id,
      action: 'alert.test_sent',
      resourceType: 'NotificationDelivery',
      resourceId: delivery.id,
      metadata: { status: delivery.status },
    });
    return {
      status: delivery.status,
      attempts: delivery.attempts,
      message:
        delivery.status === NotificationStatus.SENT
          ? 'Test email sent'
          : 'Email delivery failed; check the delivery log and Resend configuration.',
    };
  }

  async deliveries(team: TeamContext, page?: number, pageSize?: number) {
    const paging = pagination(page, pageSize);
    const where = { teamId: team.teamId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notificationDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: paging.skip,
        take: paging.take,
        select: {
          id: true,
          recipient: true,
          subject: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
          lastError: true,
          sentAt: true,
          createdAt: true,
          alertRule: { select: { type: true, project: { select: { id: true, name: true } } } },
          report: { select: { id: true, name: true } },
        },
      }),
      this.prisma.notificationDelivery.count({ where }),
    ]);
    return { items, total, ...paging };
  }

  async channels(team: TeamContext) {
    const channels = await this.prisma.notificationChannel.findMany({
      where: { teamId: team.teamId },
      orderBy: { createdAt: 'asc' },
    });
    return channels.map((channel) => ({
      ...channel,
      config: this.publicChannelConfig(channel.config),
    }));
  }

  async createChannel(user: AuthenticatedUser, team: TeamContext, dto: CreateChannelDto) {
    const channel = await this.prisma.notificationChannel.create({
      data: {
        teamId: team.teamId,
        name: dto.name.trim(),
        type: 'EMAIL',
        config: { emails: [...new Set(dto.emails.map((e) => e.toLowerCase()))] },
      },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'notification_channel.created',
      resourceType: 'NotificationChannel',
      resourceId: channel.id,
    });
    return { ...channel, config: this.publicChannelConfig(channel.config) };
  }

  async updateChannel(
    user: AuthenticatedUser,
    team: TeamContext,
    channelId: string,
    dto: UpdateChannelDto,
  ) {
    const channel = await this.prisma.notificationChannel.findFirst({
      where: { id: channelId, teamId: team.teamId },
    });
    if (!channel) throw new NotFoundException('Notification channel not found');
    const config = (channel.config as { emails?: string[] }) ?? {};
    const emails = dto.emails
      ? [...new Set(dto.emails.map((e) => e.toLowerCase()))]
      : config.emails ?? [];
    const updated = await this.prisma.notificationChannel.update({
      where: { id: channel.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.emails !== undefined ? { config: { emails } } : {}),
      },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'notification_channel.updated',
      resourceType: 'NotificationChannel',
      resourceId: channel.id,
    });
    return { ...updated, config: this.publicChannelConfig(updated.config) };
  }

  async deleteChannel(user: AuthenticatedUser, team: TeamContext, channelId: string) {
    const channel = await this.prisma.notificationChannel.findFirst({
      where: { id: channelId, teamId: team.teamId },
    });
    if (!channel) throw new NotFoundException('Notification channel not found');
    await this.prisma.notificationChannel.delete({ where: { id: channel.id } });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'notification_channel.deleted',
      resourceType: 'NotificationChannel',
      resourceId: channel.id,
    });
    return { deleted: true };
  }

  private async assertProject(team: TeamContext, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, teamId: team.teamId },
      select: { id: true, name: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private publicChannelConfig(config: Prisma.JsonValue) {
    const emails = (config as { emails?: unknown })?.emails;
    return { emails: Array.isArray(emails) ? emails : [] };
  }

  private buildHtml(context: AlertContext): string {
    const webUrl = process.env.WEB_URL || 'http://localhost:5173';
    const path =
      context.dashboardPath ??
      (context.event === AlertEventType.NEW_ERROR
        ? `/errors?projectId=${context.projectId}`
        : context.event === AlertEventType.HEARTBEAT_FAILURE
          ? `/heartbeat?projectId=${context.projectId}`
          : context.event === AlertEventType.DATABASE_CONNECTION_FAILURE
            ? `/databases?projectId=${context.projectId}`
            : `/incidents?projectId=${context.projectId}`);
    const actionUrl = `${webUrl}${path}`;
    const severity = context.severity ? context.severity.toUpperCase() : 'HIGH';
    const accent = context.event === AlertEventType.RECOVERY ? '#7da889' : '#d8a54a';
    return shellEmail(`
      <p style="margin:0 0 10px;color:${accent};font-size:11px;font-weight:700;letter-spacing:.14em;">${EVENT_LABELS[context.event].toUpperCase()}</p>
      <h1 style="margin:0 0 12px;color:#f2f3ed;font-size:22px;line-height:1.3;letter-spacing:-.02em;">${escapeHtml(context.title)}</h1>
      <p style="margin:0 0 20px;color:#b4b9ae;font-size:14px;line-height:1.7;">${escapeHtml(context.summary)}</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:13px;">
        <tr><td style="padding:8px 0;border-top:1px solid #2b302a;color:#777e72;">Project</td><td style="padding:8px 0;border-top:1px solid #2b302a;color:#dce0d5;text-align:right;">${escapeHtml(context.projectName)}</td></tr>
        ${context.monitorName ? `<tr><td style="padding:8px 0;border-top:1px solid #2b302a;color:#777e72;">Endpoint</td><td style="padding:8px 0;border-top:1px solid #2b302a;color:#dce0d5;text-align:right;">${escapeHtml(context.monitorName)}</td></tr>` : ''}
        ${context.serviceName ? `<tr><td style="padding:8px 0;border-top:1px solid #2b302a;color:#777e72;">Service</td><td style="padding:8px 0;border-top:1px solid #2b302a;color:#dce0d5;text-align:right;">${escapeHtml(context.serviceName)}</td></tr>` : ''}
        <tr><td style="padding:8px 0;border-top:1px solid #2b302a;color:#777e72;">Severity</td><td style="padding:8px 0;border-top:1px solid #2b302a;color:${accent};text-align:right;font-weight:600;">${escapeHtml(severity)}</td></tr>
      </table>
      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#dfe4d4;color:#171915;text-decoration:none;padding:11px 18px;border-radius:6px;font-size:13px;font-weight:600;">Open in Outpost</a>
      <p style="margin:22px 0 0;color:#6f776a;font-size:11px;line-height:1.6;">For security, private stack traces, credentials, and request details are never included in alert emails.</p>
    `);
  }

  private buildText(context: AlertContext): string {
    return [
      `[Outpost] ${EVENT_LABELS[context.event]}`,
      context.title,
      context.summary,
      `Project: ${context.projectName}`,
      context.monitorName ? `Endpoint: ${context.monitorName}` : null,
      'Open Outpost for details. Credentials and private stack traces are never emailed.',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
