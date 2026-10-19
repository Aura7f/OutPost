import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { HeartbeatService } from './heartbeat.service';
import { CurrentTeam, CurrentUser, MinRole, TeamScoped } from '../../common/decorators';
import type { AuthenticatedUser, TeamContext } from '../../common/types';
import { HeartbeatHistoryQueryDto } from '../../integrations/integrations.dto';

@ApiTags('Heartbeat')
@ApiBearerAuth()
@TeamScoped()
@Controller('integrations')
export class HeartbeatController {
  constructor(private readonly heartbeat: HeartbeatService) {}

  @Post(':integrationId/verify')
  @MinRole(TeamRole.ADMIN)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify the Supabase heartbeat RPC and record the result' })
  verify(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('integrationId') integrationId: string,
  ) {
    return this.heartbeat.verify(user, team, integrationId);
  }

  @Post(':integrationId/heartbeat/run')
  @MinRole(TeamRole.ADMIN)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  run(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('integrationId') integrationId: string,
  ) {
    return this.heartbeat.runManual(user, team, integrationId);
  }

  @Get(':integrationId/heartbeat')
  summary(@CurrentTeam() team: TeamContext, @Param('integrationId') integrationId: string) {
    return this.heartbeat.summary(team, integrationId);
  }

  @Get(':integrationId/heartbeat/runs')
  history(
    @CurrentTeam() team: TeamContext,
    @Param('integrationId') integrationId: string,
    @Query() query: HeartbeatHistoryQueryDto,
  ) {
    return this.heartbeat.history(team, integrationId, query);
  }
}
