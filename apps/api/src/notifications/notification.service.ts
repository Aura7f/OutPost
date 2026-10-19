import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { redactSecrets } from '../common/crypto';

export interface CreateDeliveryInput {
  teamId: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  alertRuleId?: string;
  incidentId?: string;
  channelId?: string;
  reportId?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

const MAX_ATTEMPTS = 5;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async enqueueAndSend(input: CreateDeliveryInput) {
    const delivery = await this.prisma.notificationDelivery.create({
      data: {
        teamId: input.teamId,
        recipient: input.recipient,
        subject: input.subject,
        bodyHtml: input.html,
        bodyText: input.text,
        alertRuleId: input.alertRuleId,
        incidentId: input.incidentId,
        channelId: input.channelId,
        reportId: input.reportId,
      },
    });
    return this.deliver(delivery.id, input.attachments);
  }

  async deliver(deliveryId: string, attachments?: Array<{ filename: string; content: Buffer }>) {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: { report: { select: { content: true, name: true } } },
    });
    if (!delivery) throw new NotFoundException('Notification delivery not found');
    if (delivery.status === NotificationStatus.SENT) return delivery;

    try {
      const reportAttachments =
        attachments ??
        (delivery.report?.content
          ? [
              {
                filename: `${delivery.report.name.replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 80) || 'outpost-report'}.pdf`,
                content: Buffer.from(delivery.report.content),
              },
            ]
          : undefined);

      const result = await this.email.send({
        to: delivery.recipient,
        subject: delivery.subject,
        html: delivery.bodyHtml ?? delivery.bodyText ?? '',
        text: delivery.bodyText ?? undefined,
        attachments: reportAttachments,
      });
      return this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationStatus.SENT,
          sentAt: new Date(),
          providerId: result.providerId,
          attempts: { increment: 1 },
          lastError: null,
          nextAttemptAt: null,
        },
      });
    } catch (error) {
      const attempts = delivery.attempts + 1;
      const delayMinutes = Math.min(Math.pow(2, attempts), 60);
      const nextAttemptAt = attempts < MAX_ATTEMPTS ? new Date(Date.now() + delayMinutes * 60_000) : null;
      const message = redactSecrets((error as Error).message, 500);
      this.logger.warn(`Delivery ${delivery.id} failed (attempt ${attempts}): ${message}`);
      return this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationStatus.FAILED,
          attempts,
          lastError: message ?? 'Email delivery failed',
          nextAttemptAt,
        },
      });
    }
  }

  /** Called by the scheduler. Bounded exponential retries; no infinite loops. */
  async retryPending(limit = 20): Promise<{ processed: number; sent: number }> {
    const failed = await this.prisma.notificationDelivery.findMany({
      where: {
        status: NotificationStatus.FAILED,
        attempts: { lt: MAX_ATTEMPTS },
        nextAttemptAt: { lte: new Date() },
      },
      select: { id: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    let sent = 0;
    for (const delivery of failed) {
      const result = await this.deliver(delivery.id);
      if (result.status === NotificationStatus.SENT) sent += 1;
    }
    return { processed: failed.length, sent };
  }

  async deliveries(teamId: string, page: number, pageSize: number) {
    const where = { teamId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notificationDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          recipient: true,
          subject: true,
          status: true,
          attempts: true,
          lastError: true,
          providerId: true,
          sentAt: true,
          createdAt: true,
          nextAttemptAt: true,
          alertRule: { select: { id: true, type: true, project: { select: { id: true, name: true } } } },
          report: { select: { id: true, name: true } },
        },
      }),
      this.prisma.notificationDelivery.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
