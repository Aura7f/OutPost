import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamRole } from '@prisma/client';
import { ProjectsService } from './projects.service';
import {
  CreateProjectDto,
  CreateServiceDto,
  UpdateProjectDto,
  UpdateServiceDto,
} from './projects.dto';
import { CurrentTeam, CurrentUser, MinRole, TeamScoped } from '../common/decorators';
import type { AuthenticatedUser, TeamContext } from '../common/types';

@ApiTags('Projects')
@ApiBearerAuth()
@TeamScoped()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'List projects in the active team' })
  list(@CurrentTeam() team: TeamContext) {
    return this.projects.list(team);
  }

  @Post()
  @MinRole(TeamRole.ADMIN)
  @ApiOperation({ summary: 'Create a project and issue a new ingestion key' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(user, team, dto);
  }

  @Get(':projectId')
  get(@CurrentTeam() team: TeamContext, @Param('projectId') projectId: string) {
    return this.projects.get(team, projectId);
  }

  @Get(':projectId/dashboard')
  @ApiOperation({ summary: 'Aggregated real-time project dashboard data' })
  dashboard(@CurrentTeam() team: TeamContext, @Param('projectId') projectId: string) {
    return this.projects.dashboard(team, projectId);
  }

  @Patch(':projectId')
  @MinRole(TeamRole.ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user, team, projectId, dto);
  }

  @Delete(':projectId')
  @MinRole(TeamRole.ADMIN)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.delete(user, team, projectId);
  }

  @Post(':projectId/ingestion-key/rotate')
  @MinRole(TeamRole.ADMIN)
  @ApiOperation({ summary: 'Rotate the project error ingestion key; the old key is invalidated' })
  rotateKey(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.rotateIngestionKey(user, team, projectId);
  }

  @Get(':projectId/services')
  listServices(@CurrentTeam() team: TeamContext, @Param('projectId') projectId: string) {
    return this.projects.listServices(team, projectId);
  }

  @Post(':projectId/services')
  @MinRole(TeamRole.ADMIN)
  createService(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('projectId') projectId: string,
    @Body() dto: CreateServiceDto,
  ) {
    return this.projects.createService(user, team, projectId, dto);
  }
}

@ApiTags('Services')
@ApiBearerAuth()
@TeamScoped()
@Controller('services')
export class ServicesController {
  constructor(private readonly projects: ProjectsService) {}

  @Patch(':serviceId')
  @MinRole(TeamRole.ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('serviceId') serviceId: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.projects.updateService(user, team, serviceId, dto);
  }

  @Delete(':serviceId')
  @MinRole(TeamRole.ADMIN)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('serviceId') serviceId: string,
  ) {
    return this.projects.deleteService(user, team, serviceId);
  }
}
