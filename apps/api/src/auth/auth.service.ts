import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types';
import { UpdateProfileDto } from './auth.dto';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(user: AuthenticatedUser) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: user.profileId },
      include: {
        team: {
          select: { id: true, name: true, slug: true, ownerId: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const profile = await this.prisma.userProfile.findUniqueOrThrow({
      where: { id: user.profileId },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    return {
      user: profile,
      teams: memberships.map((membership) => ({
        ...membership.team,
        role: membership.role,
        membershipId: membership.id,
      })),
    };
  }

  async updateProfile(user: AuthenticatedUser, dto: UpdateProfileDto) {
    const profile = await this.prisma.userProfile.update({
      where: { id: user.profileId },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName?.trim() || null } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl || null } : {}),
      },
      select: { id: true, email: true, fullName: true, avatarUrl: true, createdAt: true },
    });
    return profile;
  }

  async getProfile(user: AuthenticatedUser) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { id: user.profileId },
      select: { id: true, email: true, fullName: true, avatarUrl: true, createdAt: true },
    });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

}
