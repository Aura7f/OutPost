import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { TeamScopeGuard } from './team-scope.guard';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createGuard(teamScoped = true, membership: unknown = null) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(teamScoped),
  };
  const prisma = {
    teamMember: { findUnique: jest.fn().mockResolvedValue(membership) },
  };
  const guard = new TeamScopeGuard(reflector as never, prisma as never);
  return { guard, reflector, prisma };
}

describe('TeamScopeGuard', () => {
  it('skips unscoped routes', async () => {
    const { guard, prisma } = createGuard(false);
    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    expect(prisma.teamMember.findUnique).not.toHaveBeenCalled();
  });

  it('requires an authenticated user on team-scoped routes', async () => {
    const { guard } = createGuard(true);
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('requires an explicit team context', async () => {
    const { guard } = createGuard(true);
    await expect(
      guard.canActivate(contextFor({ user: { profileId: 'user-1' }, headers: {}, params: {} })),
    ).rejects.toThrow('X-Team-Id header is required');
  });

  it('rejects a header that disagrees with the route team', async () => {
    const { guard, prisma } = createGuard(true);
    await expect(
      guard.canActivate(
        contextFor({
          user: { profileId: 'user-1' },
          headers: { 'x-team-id': 'team-a' },
          params: { teamId: 'team-b' },
        }),
      ),
    ).rejects.toThrow('Team context does not match the requested resource');
    expect(prisma.teamMember.findUnique).not.toHaveBeenCalled();
  });

  it('never widens access through a forged team header', async () => {
    const { guard, prisma } = createGuard(true, null);
    await expect(
      guard.canActivate(
        contextFor({
          user: { profileId: 'user-1' },
          headers: { 'x-team-id': 'team-foreign' },
          params: {},
        }),
      ),
    ).rejects.toThrow('You do not have access to this team');
    expect(prisma.teamMember.findUnique).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: 'team-foreign', userId: 'user-1' } },
      select: { id: true, role: true, teamId: true },
    });
  });

  it('resolves route-scoped teams and records the verified role', async () => {
    const { guard, prisma } = createGuard(true, { id: 'member-1', role: 'ADMIN', teamId: 'team-a' });
    const request = {
      user: { profileId: 'user-1' },
      headers: {},
      params: { teamId: 'team-a' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(prisma.teamMember.findUnique).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: 'team-a', userId: 'user-1' } },
      select: { id: true, role: true, teamId: true },
    });
    expect(request).toMatchObject({
      teamContext: { teamId: 'team-a', role: 'ADMIN', memberId: 'member-1' },
    });
  });

  it('resolves header-scoped teams', async () => {
    const { guard } = createGuard(true, { id: 'member-2', role: 'VIEWER', teamId: 'team-b' });
    const request = {
      user: { profileId: 'user-2' },
      headers: { 'x-team-id': 'team-b' },
      params: {},
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request).toMatchObject({
      teamContext: { teamId: 'team-b', role: 'VIEWER', memberId: 'member-2' },
    });
  });
});
