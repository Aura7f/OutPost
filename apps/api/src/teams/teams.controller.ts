import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamRole } from '@prisma/client';
import { TeamsService } from './teams.service';
import {
  CreateTeamDto,
  DeleteTeamDto,
  TransferOwnershipDto,
  UpdateMemberRoleDto,
  UpdateTeamDto,
} from './teams.dto';
import {
  CurrentTeam,
  CurrentUser,
  MinRole,
  TeamScoped,
} from '../common/decorators';
import type { AuthenticatedUser, TeamContext } from '../common/types';
import { AuditService } from '../audit/audit.service';
import { PaginationQueryDto } from '../common/pagination.dto';
import { pagination } from '../common/utils';

@ApiTags('Teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  @ApiOperation({ summary: 'List teams the current user belongs to' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.teamsService.listForUser(user);
  }

  @Post()
  @ApiOperation({ summary: 'Create a team; the creator becomes owner' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTeamDto) {
    return this.teamsService.create(user, dto);
  }
}

@ApiTags('Teams')
@ApiBearerAuth()
@TeamScoped()
@Controller('teams/:teamId')
export class TeamManagementController {
  constructor(
    private readonly teamsService: TeamsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @CurrentTeam() team: TeamContext) {
    return this.teamsService.get(user, team);
  }

  @Patch()
  @MinRole(TeamRole.ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.update(user, team, dto);
  }

  @Delete()
  @MinRole(TeamRole.OWNER)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Body() dto: DeleteTeamDto,
  ) {
    return this.teamsService.delete(user, team, dto);
  }

  @Get('members')
  members(@CurrentTeam() team: TeamContext) {
    return this.teamsService.members(team);
  }

  @Patch('members/:memberId')
  @MinRole(TeamRole.ADMIN)
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.teamsService.updateMemberRole(user, team, memberId, dto);
  }

  @Delete('members/:memberId')
  @MinRole(TeamRole.ADMIN)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('memberId') memberId: string,
  ) {
    return this.teamsService.removeMember(user, team, memberId);
  }

  @Post('leave')
  leave(@CurrentUser() user: AuthenticatedUser, @CurrentTeam() team: TeamContext) {
    return this.teamsService.leave(user, team);
  }

  @Post('transfer-ownership')
  @MinRole(TeamRole.OWNER)
  transfer(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Body() dto: TransferOwnershipDto,
  ) {
    return this.teamsService.transferOwnership(user, team, dto.memberId);
  }

  @Get('audit')
  @MinRole(TeamRole.ADMIN)
  async auditLog(
    @CurrentTeam() team: TeamContext,
    @Query() query: PaginationQueryDto,
  ) {
    const { page, pageSize } = pagination(query.page, query.pageSize);
    return this.audit.list(team.teamId, page, pageSize);
  }
}
