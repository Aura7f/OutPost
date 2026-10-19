import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { TEAM_SCOPED_KEY } from '../common/decorators';
import type { OutpostRequest } from '../common/types';

/**
 * Resolves one active team for every tenant-scoped request and verifies
 * membership server-side. The X-Team-Id header can never widen access.
 */
@Injectable()
export class TeamScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const teamScoped = this.reflector.getAllAndOverride<boolean>(TEAM_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!teamScoped) return true;

    const request = context.switchToHttp().getRequest<OutpostRequest>();
    if (!request.user) throw new ForbiddenException('Authentication required');

    const headerTeam = request.headers['x-team-id'];
    const routeTeam = request.params?.teamId;
    const headerValue = Array.isArray(headerTeam) ? headerTeam[0] : headerTeam;

    if (routeTeam && headerValue && routeTeam !== headerValue) {
      throw new ForbiddenException('Team context does not match the requested resource');
    }
    const teamId = routeTeam || headerValue;
    if (!teamId || typeof teamId !== 'string') {
      throw new ForbiddenException('X-Team-Id header is required');
    }

    const membership = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: request.user.profileId,
        },
      },
      select: { id: true, role: true, teamId: true },
    });
    if (!membership) throw new ForbiddenException('You do not have access to this team');

    request.teamContext = { teamId, role: membership.role, memberId: membership.id };
    return true;
  }
}
