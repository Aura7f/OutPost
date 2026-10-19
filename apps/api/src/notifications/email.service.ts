import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { escapeHtml } from '../common/utils';

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string | Buffer }>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client?: Resend;
  private readonly from: string;
  private readonly replyTo?: string;

  constructor(private readonly config: ConfigService) {
    const key = config.get<string>('RESEND_API_KEY');
    this.client = key ? new Resend(key) : undefined;
    this.from = config.get<string>('EMAIL_FROM', 'Outpost <alerts@outpost.local>');
    this.replyTo = config.get<string>('EMAIL_REPLY_TO') || undefined;
  }

  get configured(): boolean {
    return Boolean(this.client);
  }

  async send(message: EmailMessage): Promise<{ providerId: string | null }> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Email is not configured. Set RESEND_API_KEY and EMAIL_FROM on the API server.',
      );
    }
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    if (recipients.length === 0 || recipients.some((email) => !email.includes('@'))) {
      throw new Error('No valid email recipients');
    }
    const result = await this.client.emails.send({
      from: this.from,
      to: recipients,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo || this.replyTo,
      attachments: message.attachments,
    });
    if (result.error) {
      this.logger.warn(`Resend delivery failed: ${result.error.message}`);
      throw new Error(result.error.message);
    }
    return { providerId: result.data?.id ?? null };
  }

  invitationEmail(input: {
    teamName: string;
    inviterName: string;
    role: string;
    acceptUrl: string;
    expiresAt: Date;
  }): EmailMessage {
    const safeTeam = escapeHtml(input.teamName);
    const safeInviter = escapeHtml(input.inviterName);
    const subject = `${input.inviterName} invited you to ${input.teamName} on Outpost`;
    const html = shellEmail(`
      <p style="margin:0 0 16px;color:#a9afa3;font-size:14px;">TEAM INVITATION</p>
      <h1 style="margin:0 0 12px;color:#f2f3ed;font-size:24px;font-weight:600;letter-spacing:-.02em;">You're invited to ${safeTeam}</h1>
      <p style="margin:0 0 24px;color:#b4b9ae;font-size:15px;line-height:1.65;">${safeInviter} invited you to join <strong>${safeTeam}</strong> on Outpost as a <strong>${escapeHtml(input.role)}</strong>.</p>
      <a href="${input.acceptUrl}" style="display:inline-block;background:#dfe4d4;color:#171915;text-decoration:none;padding:11px 18px;border-radius:6px;font-size:14px;font-weight:600;">Accept invitation</a>
      <p style="margin:24px 0 0;color:#777e72;font-size:12px;line-height:1.6;">This invitation expires ${input.expiresAt.toUTCString()}. If you were not expecting it, you can safely ignore this email.</p>
    `);
    return {
      to: '',
      subject,
      html,
      text: `${input.inviterName} invited you to ${input.teamName} on Outpost as ${input.role}. Accept: ${input.acceptUrl}`,
    };
  }
}

export function shellEmail(content: string): string {
  return `<!doctype html><html><body style="margin:0;background:#101210;padding:32px 16px;font-family:Inter,-apple-system,Segoe UI,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#171a17;border:1px solid #2b302a;border-radius:10px;overflow:hidden;">
      <div style="padding:20px 28px;border-bottom:1px solid #262b25;">
        <span style="color:#dfe4d4;font-size:14px;font-weight:700;letter-spacing:.16em;">OUTPOST</span>
        <span style="color:#6f776a;font-size:12px;margin-left:10px;">Monitor. Detect. Protect.</span>
      </div>
      <div style="padding:32px 28px;">${content}</div>
      <div style="padding:16px 28px;border-top:1px solid #262b25;color:#636b5f;font-size:11px;line-height:1.6;">
        Sent by Outpost. Monitoring credentials and private stack traces are never included in email alerts.
      </div>
    </div>
  </body></html>`;
}
