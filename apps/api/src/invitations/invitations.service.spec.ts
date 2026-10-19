import { ForbiddenException } from '@nestjs/common';
import { TeamRole } from '@prisma/client';
import { InvitationsService } from './invitations.service';
import type { AuthenticatedUser, TeamContext } from '../common/types';

describe('InvitationsService role policy', () => {
  const service = new InvitationsService({} as never, {} as never, {} as never, {} as never);
  const user = {
    profileId: 'user-1',
    email: 'owner@example.com',
    fullName: 'Owner',
  } as AuthenticatedUser;
  const team = {
    teamId: 'team-1',
    memberId: 'member-1',
    role: TeamRole.ADMIN,
  } as TeamContext;

  it('prevents admins from inviting another admin', async () => {
    await expect(
      service.create(user, team, { email: 'new-admin@example.com', role: TeamRole.ADMIN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents viewers from inviting members', async () => {
    await expect(
      service.create(
        user,
        { ...team, role: TeamRole.VIEWER },
        { email: 'viewer@example.com', role: TeamRole.VIEWER },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never allows ownership to be granted through an invitation', async () => {
    await expect(
      service.create(
        user,
        { ...team, role: TeamRole.OWNER },
        { email: 'new-owner@example.com', role: TeamRole.OWNER },
      ),
    ).rejects.toThrow('Ownership must be transferred, not invited');
  });
});
