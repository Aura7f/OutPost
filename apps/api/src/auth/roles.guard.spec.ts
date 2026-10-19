import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { TeamRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function contextWithRole(role?: TeamRole): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ teamContext: role ? { role, teamId: 'team-1', memberId: 'm-1' } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

function createGuard(minRole?: TeamRole) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(minRole),
  };
  return new RolesGuard(reflector as never);
}

describe('RolesGuard', () => {
  it('skips handlers without a minimum role', () => {
    expect(createGuard().canActivate(contextWithRole('VIEWER'))).toBe(true);
  });

  it('allows a role equal to the requirement', () => {
    expect(createGuard('VIEWER').canActivate(contextWithRole('VIEWER'))).toBe(true);
    expect(createGuard('ADMIN').canActivate(contextWithRole('ADMIN'))).toBe(true);
    expect(createGuard('OWNER').canActivate(contextWithRole('OWNER'))).toBe(true);
  });

  it('allows higher roles to satisfy lower requirements', () => {
    expect(createGuard('VIEWER').canActivate(contextWithRole('ADMIN'))).toBe(true);
    expect(createGuard('ADMIN').canActivate(contextWithRole('OWNER'))).toBe(true);
  });

  it('denies lower roles', () => {
    expect(() => createGuard('ADMIN').canActivate(contextWithRole('VIEWER'))).toThrow(
      ForbiddenException,
    );
    expect(() => createGuard('OWNER').canActivate(contextWithRole('ADMIN'))).toThrow(
      'requires the owner role',
    );
  });

  it('denies requests without a resolved team context', () => {
    expect(() => createGuard('VIEWER').canActivate(contextWithRole())).toThrow(
      'requires the viewer role',
    );
  });
});
