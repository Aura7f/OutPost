import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TeamRole } from '@prisma/client';
import { MIN_ROLE_KEY } from '../common/decorators';
import type { OutpostRequest } from '../common/types';

const ROLE_WEIGHT: Record<TeamRole, number> = {
  VIEWER: 1,
  ADMIN: 2,
  OWNER: 3,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const minRole = this.reflector.getAllAndOverride<TeamRole>(MIN_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!minRole) return true;

    const request = context.switchToHttp().getRequest<OutpostRequest>();
    const role = request.teamContext?.role;
    if (!role || ROLE_WEIGHT[role] < ROLE_WEIGHT[minRole]) {
      throw new ForbiddenException(`This action requires the ${minRole.toLowerCase()} role`);
    }
    return true;
  }
}
