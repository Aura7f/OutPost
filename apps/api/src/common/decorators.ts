import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { TeamRole } from '@prisma/client';
import type { AuthenticatedUser, OutpostRequest, TeamContext } from './types';

export const IS_PUBLIC_KEY = 'outpost:isPublic';
export const TEAM_SCOPED_KEY = 'outpost:teamScoped';
export const MIN_ROLE_KEY = 'outpost:minRole';

/** Skips JWT auth and team context checks. Used only by health, ingestion, cron, and shared reports. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires a verified team membership. Reads X-Team-Id or a :teamId route parameter. */
export const TeamScoped = () => SetMetadata(TEAM_SCOPED_KEY, true);

/** Require at least the supplied role for a handler. */
export const MinRole = (role: TeamRole) => SetMetadata(MIN_ROLE_KEY, role);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<OutpostRequest>();
    return request.user;
  },
);

export const CurrentTeam = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TeamContext => {
    const request = context.switchToHttp().getRequest<OutpostRequest>();
    return request.teamContext as TeamContext;
  },
);

export const RequestContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): { ip?: string; userAgent?: string } => {
    const request = context.switchToHttp().getRequest<OutpostRequest>();
    return {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  },
);
