import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { DatabaseMetricsService } from './database-metrics.service';
import { CurrentTeam, CurrentUser, MinRole, TeamScoped } from '../../common/decorators';
import type { AuthenticatedUser, TeamContext } from '../../common/types';

@ApiTags('Database monitoring')
@ApiBearerAuth()
@TeamScoped()
@Controller()
export class DatabaseController {
  constructor(private readonly metrics: DatabaseMetricsService) {}

  @Get('databases/overview')
  overview(@CurrentTeam() team: TeamContext, @Query('projectId') projectId?: string) {
    return this.metrics.overview(team, projectId);
  }

  @Get('integrations/:integrationId/metrics')
  metricsFor(
    @CurrentTeam() team: TeamContext,
    @Param('integrationId') integrationId: string,
    @Query('range') range?: '24h' | '7d' | '30d',
  ) {
    return this.metrics.metricsFor(team, integrationId, {
      range: range === '7d' || range === '30d' ? range : '24h',
    });
  }

  @Post('integrations/:integrationId/metrics/refresh')
  @MinRole(TeamRole.ADMIN)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: 'Collect a real database metric snapshot through the read-only monitoring role' })
  refresh(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('integrationId') integrationId: string,
  ) {
    return this.metrics.refresh(user, team, integrationId);
  }
}
