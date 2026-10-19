import type { Request } from 'express';
import type { TeamRole } from '@prisma/client';

export interface AuthenticatedUser {
  profileId: string;
  supabaseUserId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface TeamContext {
  teamId: string;
  role: TeamRole;
  memberId: string;
}

export interface OutpostRequest extends Request {
  user: AuthenticatedUser;
  teamContext?: TeamContext;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}
