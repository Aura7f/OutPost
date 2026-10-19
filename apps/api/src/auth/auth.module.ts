import { Module } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TeamScopeGuard } from './team-scope.guard';
import { RolesGuard } from './roles.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [JwtAuthGuard, TeamScopeGuard, RolesGuard, AuthService],
  exports: [JwtAuthGuard, TeamScopeGuard, RolesGuard],
})
export class AuthModule {}
