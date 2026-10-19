import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitationStatus, TeamRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { generateToken, sha256 } from '../common/crypto';
import type { AuthenticatedUser, TeamContext } from '../common/types';
import type { InviteMemberDto } from '../teams/teams.dto';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async create(user: AuthenticatedUser, team: TeamContext, dto: InviteMemberDto) {
    if (team.role === TeamRole.VIEWER) throw new ForbiddenException('Admin access required');
    if (dto.role === TeamRole.OWNER) throw new BadRequestException('Ownership must be transferred, not invited');
    if (dto.role === TeamRole.ADMIN && team.role !== TeamRole.OWNER) {
      throw new ForbiddenException('Only the owner can invite admins');
    }

    const email = dto.email.trim().toLowerCase();
    if (email === user.email.toLowerCase()) throw new BadRequestException('You are already a member');

    const existingProfile = await this.prisma.userProfile.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingProfile) {
      const membership = await this.prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: team.teamId, userId: existingProfile.id } },
      });
      if (membership) throw new ConflictException('That person is already a team member');
    }

    const teamRecord = await this.prisma.team.findUniqueOrThrow({
      where: { id: team.teamId },
      select: { name: true },
    });
    const token = generateToken('invite');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.teamInvitation.updateMany({
        where: { teamId: team.teamId, email, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.REVOKED },
      }),
      this.prisma.teamInvitation.create({
        data: {
          teamId: team.teamId,
          email,
          role: dto.role,
          tokenHash: sha256(token),
          invitedById: user.profileId,
          expiresAt,
        },
      }),
    ]);

    const inviteUrl = `${this.config.get<string>('WEB_URL', 'http://localhost:5173')}/invitations/${token}`;
    const message = this.email.invitationEmail({
      teamName: teamRecord.name,
      inviterName: user.fullName || user.email,
      role: dto.role.toLowerCase(),
      acceptUrl: inviteUrl,
      expiresAt,
    });
    let emailDelivered = false;
    let emailError: string | null = null;
    try {
      await this.email.send({ ...message, to: email });
      emailDelivered = true;
    } catch (error) {
      emailError = (error as Error).message;
      this.logger.warn(`Invitation ${email} created but email delivery failed: ${emailError}`);
    }

    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'invitation.created',
      resourceType: 'TeamInvitation',
      metadata: { email, role: dto.role, emailDelivered },
    });

    return {
      invitation: { email, role: dto.role, expiresAt, status: InvitationStatus.PENDING },
      emailDelivered,
      emailError,
      // Only returned to the admin who created the invitation, never stored in plaintext.
      inviteUrl: emailDelivered ? undefined : inviteUrl,
    };
  }

  async list(team: TeamContext) {
    return this.prisma.teamInvitation.findMany({
      where: { teamId: team.teamId, status: InvitationStatus.PENDING },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(user: AuthenticatedUser, team: TeamContext, invitationId: string) {
    if (team.role === TeamRole.VIEWER) throw new ForbiddenException('Admin access required');
    const invitation = await this.prisma.teamInvitation.findFirst({
      where: { id: invitationId, teamId: team.teamId, status: InvitationStatus.PENDING },
    });
    if (!invitation) throw new NotFoundException('Pending invitation not found');
    await this.prisma.teamInvitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.REVOKED },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'invitation.revoked',
      resourceType: 'TeamInvitation',
      resourceId: invitation.id,
      metadata: { email: invitation.email },
    });
    return { revoked: true };
  }

  async resend(user: AuthenticatedUser, team: TeamContext, invitationId: string) {
    if (team.role === TeamRole.VIEWER) throw new ForbiddenException('Admin access required');
    const invitation = await this.prisma.teamInvitation.findFirst({
      where: { id: invitationId, teamId: team.teamId, status: InvitationStatus.PENDING },
      include: { team: { select: { name: true } } },
    });
    if (!invitation) throw new NotFoundException('Pending invitation not found');
    if (invitation.expiresAt < new Date()) {
      throw new GoneException('Invitation expired; create a new invitation');
    }

    const token = generateToken('invite');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.teamInvitation.update({
      where: { id: invitation.id },
      data: { tokenHash: sha256(token), expiresAt },
    });
    const inviteUrl = `${this.config.get<string>('WEB_URL', 'http://localhost:5173')}/invitations/${token}`;
    await this.email.send({
      ...this.email.invitationEmail({
        teamName: invitation.team.name,
        inviterName: user.fullName || user.email,
        role: invitation.role.toLowerCase(),
        acceptUrl: inviteUrl,
        expiresAt,
      }),
      to: invitation.email,
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'invitation.resent',
      resourceType: 'TeamInvitation',
      resourceId: invitation.id,
      metadata: { email: invitation.email },
    });
    return { sent: true, expiresAt };
  }

  async preview(user: AuthenticatedUser, token: string) {
    const invitation = await this.getValid(token);
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException('This invitation was sent to a different email address');
    }
    return {
      team: { name: invitation.team.name, slug: invitation.team.slug },
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      invitedBy: invitation.invitedBy?.fullName || invitation.invitedBy?.email || 'A team admin',
    };
  }

  async accept(user: AuthenticatedUser, token: string) {
    const invitation = await this.getValid(token);
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException('This invitation was sent to a different email address');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.upsert({
        where: { teamId_userId: { teamId: invitation.teamId, userId: user.profileId } },
        create: { teamId: invitation.teamId, userId: user.profileId, role: invitation.role },
        update: {},
      });
      await tx.teamInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
      });
    });
    await this.audit.log({
      teamId: invitation.teamId,
      actorId: user.profileId,
      action: 'invitation.accepted',
      resourceType: 'TeamInvitation',
      resourceId: invitation.id,
      metadata: { role: invitation.role },
    });
    return { teamId: invitation.teamId, teamName: invitation.team.name };
  }

  async decline(user: AuthenticatedUser, token: string) {
    const invitation = await this.getValid(token);
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException('This invitation was sent to a different email address');
    }
    await this.prisma.teamInvitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.DECLINED },
    });
    await this.audit.log({
      teamId: invitation.teamId,
      actorId: user.profileId,
      action: 'invitation.declined',
      resourceType: 'TeamInvitation',
      resourceId: invitation.id,
    });
    return { declined: true };
  }

  async pendingForUser(user: AuthenticatedUser) {
    return this.prisma.teamInvitation.findMany({
      where: {
        email: user.email.toLowerCase(),
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        team: { select: { name: true, slug: true } },
        invitedBy: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async getValid(token: string) {
    if (!token || token.length > 200) throw new BadRequestException('Invalid invitation');
    const invitation = await this.prisma.teamInvitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        team: { select: { name: true, slug: true } },
        invitedBy: { select: { fullName: true, email: true } },
      },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(`This invitation was already ${invitation.status.toLowerCase()}`);
    }
    if (invitation.expiresAt < new Date()) {
      await this.prisma.teamInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new GoneException('This invitation has expired');
    }
    return invitation;
  }
}
