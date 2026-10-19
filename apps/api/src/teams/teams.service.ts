import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TeamRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../common/utils';
import type { AuthenticatedUser, TeamContext } from '../common/types';
import type { CreateTeamDto, DeleteTeamDto, UpdateMemberRoleDto, UpdateTeamDto } from './teams.dto';

const ROLE_WEIGHT: Record<TeamRole, number> = { VIEWER: 1, ADMIN: 2, OWNER: 3 };

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async listForUser(user: AuthenticatedUser) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: user.profileId },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            slug: true,
            ownerId: true,
            retentionDays: true,
            createdAt: true,
            _count: { select: { projects: true, members: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map(({ team, role, id }) => ({
      ...team,
      role,
      membershipId: id,
    }));
  }

  async create(user: AuthenticatedUser, dto: CreateTeamDto) {
    const base = slugify(dto.name) || 'team';
    let slug = base;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const exists = await this.prisma.team.findUnique({ where: { slug }, select: { id: true } });
      if (!exists) break;
      slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
    }

    const team = await this.prisma.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: {
          name: dto.name.trim(),
          slug,
          ownerId: user.profileId,
          retentionDays: this.config.get<number>('DEFAULT_RETENTION_DAYS', 90),
          members: { create: { userId: user.profileId, role: TeamRole.OWNER } },
        },
        select: { id: true, name: true, slug: true, ownerId: true, retentionDays: true, createdAt: true },
      });
      return created;
    });
    await this.audit.log({
      teamId: team.id,
      actorId: user.profileId,
      action: 'team.created',
      resourceType: 'Team',
      resourceId: team.id,
      metadata: { name: team.name },
    });
    return { ...team, role: TeamRole.OWNER };
  }

  async get(user: AuthenticatedUser, team: TeamContext) {
    const record = await this.prisma.team.findUnique({
      where: { id: team.teamId },
      include: {
        owner: { select: { id: true, fullName: true, email: true } },
        _count: { select: { projects: true, members: true } },
      },
    });
    if (!record) throw new NotFoundException('Team not found');
    return { ...record, currentRole: team.role };
  }

  async update(user: AuthenticatedUser, team: TeamContext, dto: UpdateTeamDto) {
    if (ROLE_WEIGHT[team.role] < ROLE_WEIGHT.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
    const updated = await this.prisma.team.update({
      where: { id: team.teamId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.retentionDays !== undefined ? { retentionDays: dto.retentionDays } : {}),
      },
      select: { id: true, name: true, slug: true, retentionDays: true, updatedAt: true },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'team.updated',
      resourceType: 'Team',
      resourceId: team.teamId,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async delete(user: AuthenticatedUser, team: TeamContext, dto: DeleteTeamDto) {
    if (team.role !== TeamRole.OWNER) throw new ForbiddenException('Only the owner can delete a team');
    const record = await this.prisma.team.findUnique({ where: { id: team.teamId }, select: { name: true } });
    if (!record) throw new NotFoundException('Team not found');
    if (dto.confirmName !== record.name) {
      throw new BadRequestException('Team name does not match');
    }
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'team.deleted',
      resourceType: 'Team',
      resourceId: team.teamId,
      metadata: { name: record.name },
    });
    await this.prisma.team.delete({ where: { id: team.teamId } });
    return { deleted: true };
  }

  async members(team: TeamContext) {
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: team.teamId },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return members;
  }

  async updateMemberRole(
    user: AuthenticatedUser,
    team: TeamContext,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ) {
    if (ROLE_WEIGHT[team.role] < ROLE_WEIGHT.ADMIN) throw new ForbiddenException('Admin access required');
    const target = await this.prisma.teamMember.findFirst({
      where: { id: memberId, teamId: team.teamId },
    });
    if (!target) throw new NotFoundException('Team member not found');
    if (target.role === TeamRole.OWNER) throw new ForbiddenException('Transfer ownership to change the owner');
    if (target.userId === user.profileId) throw new BadRequestException('You cannot change your own role');

    if (team.role === TeamRole.ADMIN) {
      if (target.role === TeamRole.ADMIN) throw new ForbiddenException('Admins cannot manage other admins');
      if (dto.role === TeamRole.ADMIN) throw new ForbiddenException('Only the owner can promote admins');
    }
    if (target.role === dto.role) return target;

    const updated = await this.prisma.teamMember.update({
      where: { id: target.id },
      data: { role: dto.role },
      select: {
        id: true,
        role: true,
        user: { select: { id: true, email: true, fullName: true, avatarUrl: true } },
      },
    });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'member.role_changed',
      resourceType: 'TeamMember',
      resourceId: target.id,
      metadata: { from: target.role, to: dto.role, userId: target.userId },
    });
    return updated;
  }

  async removeMember(user: AuthenticatedUser, team: TeamContext, memberId: string) {
    if (ROLE_WEIGHT[team.role] < ROLE_WEIGHT.ADMIN) throw new ForbiddenException('Admin access required');
    const target = await this.prisma.teamMember.findFirst({
      where: { id: memberId, teamId: team.teamId },
    });
    if (!target) throw new NotFoundException('Team member not found');
    if (target.role === TeamRole.OWNER) throw new ForbiddenException('The owner cannot be removed');
    if (target.userId === user.profileId) throw new BadRequestException('Use leave team to remove yourself');
    if (team.role === TeamRole.ADMIN && target.role === TeamRole.ADMIN) {
      throw new ForbiddenException('Admins cannot remove other admins');
    }
    await this.prisma.teamMember.delete({ where: { id: target.id } });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'member.removed',
      resourceType: 'TeamMember',
      resourceId: target.id,
      metadata: { userId: target.userId, role: target.role },
    });
    return { removed: true };
  }

  async leave(user: AuthenticatedUser, team: TeamContext) {
    if (team.role === TeamRole.OWNER) {
      throw new ForbiddenException('Transfer ownership before leaving the team');
    }
    await this.prisma.teamMember.delete({ where: { id: team.memberId } });
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'member.left',
      resourceType: 'TeamMember',
      resourceId: team.memberId,
    });
    return { left: true };
  }

  async transferOwnership(user: AuthenticatedUser, team: TeamContext, memberId: string) {
    if (team.role !== TeamRole.OWNER) throw new ForbiddenException('Only the owner can transfer ownership');
    const target = await this.prisma.teamMember.findFirst({
      where: { id: memberId, teamId: team.teamId },
      include: { user: { select: { email: true } } },
    });
    if (!target) throw new NotFoundException('Team member not found');
    if (target.userId === user.profileId) throw new BadRequestException('You already own this team');

    await this.prisma.$transaction([
      this.prisma.teamMember.update({
        where: { id: target.id },
        data: { role: TeamRole.OWNER },
      }),
      this.prisma.teamMember.update({
        where: { id: team.memberId },
        data: { role: TeamRole.ADMIN },
      }),
      this.prisma.team.update({
        where: { id: team.teamId },
        data: { ownerId: target.userId },
      }),
    ]);
    await this.audit.log({
      teamId: team.teamId,
      actorId: user.profileId,
      action: 'team.ownership_transferred',
      resourceType: 'Team',
      resourceId: team.teamId,
      metadata: { newOwnerEmail: target.user.email },
    });
    return { transferred: true };
  }

  async assertCanManageProjects(team: TeamContext): Promise<void> {
    if (ROLE_WEIGHT[team.role] < ROLE_WEIGHT.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  async getMemberRole(team: TeamContext) {
    return team.role;
  }
}
