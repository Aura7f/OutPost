import { Module } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TeamScopeGuard } from './team-scope.guard';
import { RolesGuard } from './roles.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseAuthClient } from './supabase-auth.client';

@Module({
  controllers: [AuthController],
  providers: [JwtAuthGuard, TeamScopeGuard, RolesGuard, AuthService, SupabaseAuthClient],
  exports: [JwtAuthGuard, TeamScopeGuard, RolesGuard],
})
export class AuthModule {}
