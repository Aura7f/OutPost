import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IntegrationType, TeamRole } from '@prisma/client';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto, RotateCredentialsDto, UpdateIntegrationDto } from './integrations.dto';
import { CurrentTeam, CurrentUser, MinRole, TeamScoped } from '../common/decorators';
import type { AuthenticatedUser, TeamContext } from '../common/types';

@ApiTags('Integrations')
@ApiBearerAuth()
@TeamScoped()
@Controller()
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('integrations')
  listAll(
    @CurrentTeam() team: TeamContext,
    @Query('projectId') projectId?: string,
    @Query('type') type?: string,
  ) {
    const filter = Object.values(IntegrationType).includes(type as IntegrationType)
      ? (type as IntegrationType)
      : undefined;
    return this.integrations.listAll(team, projectId, filter);
  }

  @Get('projects/:projectId/integrations')
  list(@CurrentTeam() team: TeamContext, @Param('projectId') projectId: string) {
    return this.integrations.list(team, projectId);
  }

  @Post('projects/:projectId/integrations')
  @MinRole(TeamRole.ADMIN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('projectId') projectId: string,
    @Body() dto: CreateIntegrationDto,
  ) {
    return this.integrations.create(user, team, projectId, dto);
  }

  @Get('integrations/:integrationId')
  get(@CurrentTeam() team: TeamContext, @Param('integrationId') integrationId: string) {
    return this.integrations.get(team, integrationId);
  }

  @Patch('integrations/:integrationId')
  @MinRole(TeamRole.ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('integrationId') integrationId: string,
    @Body() dto: UpdateIntegrationDto,
  ) {
    return this.integrations.update(user, team, integrationId, dto);
  }

  @Post('integrations/:integrationId/credentials')
  @MinRole(TeamRole.ADMIN)
  rotate(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('integrationId') integrationId: string,
    @Body() dto: RotateCredentialsDto,
  ) {
    return this.integrations.rotateCredentials(user, team, integrationId, dto);
  }

  @Delete('integrations/:integrationId')
  @MinRole(TeamRole.ADMIN)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('integrationId') integrationId: string,
  ) {
    return this.integrations.delete(user, team, integrationId);
  }

  @Get('integrations/:integrationId/setup-sql')
  setupSql() {
    return this.integrations.setupSql();
  }
}
