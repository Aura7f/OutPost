import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { MonitorsService } from './monitors.service';
import {
  CreateMonitorDto,
  HealthOverviewQueryDto,
  HealthRunsQueryDto,
  MonitorRunQueryDto,
  MonitorStatsQueryDto,
  UpdateMonitorDto,
} from './monitors.dto';
import { CurrentTeam, CurrentUser, MinRole, TeamScoped } from '../../common/decorators';
import type { AuthenticatedUser, TeamContext } from '../../common/types';

@ApiTags('Health monitoring')
@ApiBearerAuth()
@TeamScoped()
@Controller('projects/:projectId/monitors')
export class ProjectMonitorsController {
  constructor(private readonly monitors: MonitorsService) {}

  @Get()
  list(@CurrentTeam() team: TeamContext, @Param('projectId') projectId: string) {
    return this.monitors.list(team, projectId);
  }

  @Post()
  @MinRole(TeamRole.ADMIN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('projectId') projectId: string,
    @Body() dto: CreateMonitorDto,
  ) {
    return this.monitors.create(user, team, projectId, dto);
  }
}

@ApiTags('Health monitoring')
@ApiBearerAuth()
@TeamScoped()
@Controller('monitors')
export class MonitorsController {
  constructor(private readonly monitors: MonitorsService) {}

  @Get('egress/options')
  @ApiOperation({ summary: 'Available egress strategies (default, proxy pool, checker regions)' })
  egressOptions() {
    return this.monitors.egressOptions();
  }

  @Get(':monitorId')
  get(@CurrentTeam() team: TeamContext, @Param('monitorId') monitorId: string) {
    return this.monitors.get(team, monitorId);
  }

  @Patch(':monitorId')
  @MinRole(TeamRole.ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('monitorId') monitorId: string,
    @Body() dto: UpdateMonitorDto,
  ) {
    return this.monitors.update(user, team, monitorId, dto);
  }

  @Delete(':monitorId')
  @MinRole(TeamRole.ADMIN)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('monitorId') monitorId: string,
  ) {
    return this.monitors.delete(user, team, monitorId);
  }

  @Post(':monitorId/run')
  @MinRole(TeamRole.ADMIN)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: 'Run an immediate health check (subject to SSRF protections)' })
  run(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('monitorId') monitorId: string,
  ) {
    return this.monitors.run(user, team, monitorId);
  }

  @Get(':monitorId/runs')
  runs(
    @CurrentTeam() team: TeamContext,
    @Param('monitorId') monitorId: string,
    @Query() query: MonitorRunQueryDto,
  ) {
    return this.monitors.runs(team, monitorId, query);
  }

  @Get(':monitorId/stats')
  stats(
    @CurrentTeam() team: TeamContext,
    @Param('monitorId') monitorId: string,
    @Query() query: MonitorStatsQueryDto,
  ) {
    return this.monitors.stats(team, monitorId, query);
  }
}

@ApiTags('Health monitoring')
@ApiBearerAuth()
@TeamScoped()
@Controller('health')
export class HealthController {
  constructor(private readonly monitors: MonitorsService) {}

  @Get('overview')
  overview(@CurrentTeam() team: TeamContext, @Query() query: HealthOverviewQueryDto) {
    return this.monitors.overview(team, query.projectId);
  }

  @Get('runs')
  history(@CurrentTeam() team: TeamContext, @Query() query: HealthRunsQueryDto) {
    return this.monitors.history(team, query);
  }
}
