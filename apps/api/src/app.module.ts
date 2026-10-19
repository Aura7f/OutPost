import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnvironment } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TeamScopeGuard } from './auth/team-scope.guard';
import { RolesGuard } from './auth/roles.guard';
import { TeamsModule } from './teams/teams.module';
import { ProjectsModule } from './projects/projects.module';
import { HealthModule } from './monitoring/health/health.module';
import { HeartbeatModule } from './monitoring/heartbeat/heartbeat.module';
import { DatabaseModule } from './monitoring/database/database.module';
import { ErrorsModule } from './monitoring/errors/errors.module';
import { IncidentsModule } from './incidents/incidents.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 240,
      },
    ]),
    PrismaModule,
    CommonModule,
    AuditModule,
    AuthModule,
    TeamsModule,
    ProjectsModule,
    HealthModule,
    HeartbeatModule,
    DatabaseModule,
    ErrorsModule,
    IncidentsModule,
    IntegrationsModule,
    NotificationsModule,
    ReportsModule,
    SchedulerModule,
  ],
  controllers: [AppController],
  providers: [
    // Order matters: rate limit first, then authenticate, resolve tenant,
    // and finally enforce the minimum role for the handler.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TeamScopeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
