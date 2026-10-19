import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TeamRole } from '@prisma/client';
import { IncidentsService } from './incidents.service';
import { IncidentQueryDto, ResolveIncidentDto } from './incidents.dto';
import { CurrentTeam, CurrentUser, MinRole, TeamScoped } from '../common/decorators';
import type { AuthenticatedUser, TeamContext } from '../common/types';

@ApiTags('Incidents')
@ApiBearerAuth()
@TeamScoped()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  list(@CurrentTeam() team: TeamContext, @Query() query: IncidentQueryDto) {
    return this.incidents.list(team, query);
  }

  @Get('summary')
  summary(@CurrentTeam() team: TeamContext, @Query('projectId') projectId?: string) {
    return this.incidents.summary(team, projectId);
  }

  @Get(':incidentId')
  get(@CurrentTeam() team: TeamContext, @Param('incidentId') incidentId: string) {
    return this.incidents.get(team, incidentId);
  }

  @Post(':incidentId/acknowledge')
  @MinRole(TeamRole.ADMIN)
  acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('incidentId') incidentId: string,
  ) {
    return this.incidents.acknowledge(user, team, incidentId);
  }

  @Patch(':incidentId/resolve')
  @MinRole(TeamRole.ADMIN)
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('incidentId') incidentId: string,
    @Body() dto: ResolveIncidentDto,
  ) {
    return this.incidents.resolve(user, team, incidentId, dto.note);
  }
}
