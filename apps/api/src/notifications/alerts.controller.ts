import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TeamRole } from '@prisma/client';
import { AlertsService } from './alerts.service';
import { CreateAlertRuleDto, CreateChannelDto, TestAlertDto, UpdateAlertRuleDto, UpdateChannelDto } from './alerts.dto';
import { CurrentTeam, CurrentUser, MinRole, TeamScoped } from '../common/decorators';
import type { AuthenticatedUser, TeamContext } from '../common/types';
import { PaginationQueryDto } from '../common/pagination.dto';

@ApiTags('Alerts')
@ApiBearerAuth()
@TeamScoped()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('rules')
  rules(@CurrentTeam() team: TeamContext, @Query('projectId') projectId?: string) {
    return this.alerts.listRules(team, projectId);
  }

  @Post('rules')
  @MinRole(TeamRole.ADMIN)
  createRule(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Body() dto: CreateAlertRuleDto,
  ) {
    return this.alerts.createRule(user, team, dto);
  }

  @Patch('rules/:ruleId')
  @MinRole(TeamRole.ADMIN)
  updateRule(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateAlertRuleDto,
  ) {
    return this.alerts.updateRule(user, team, ruleId, dto);
  }

  @Post('test')
  @MinRole(TeamRole.ADMIN)
  test(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Body() dto: TestAlertDto,
  ) {
    return this.alerts.test(user, team, dto);
  }

  @Get('deliveries')
  deliveries(@CurrentTeam() team: TeamContext, @Query() query: PaginationQueryDto) {
    return this.alerts.deliveries(team, query.page, query.pageSize);
  }
}

@ApiTags('Notifications')
@ApiBearerAuth()
@TeamScoped()
@Controller('notifications/channels')
export class NotificationChannelsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@CurrentTeam() team: TeamContext) {
    return this.alerts.channels(team);
  }

  @Post()
  @MinRole(TeamRole.ADMIN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Body() dto: CreateChannelDto,
  ) {
    return this.alerts.createChannel(user, team, dto);
  }

  @Patch(':channelId')
  @MinRole(TeamRole.ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.alerts.updateChannel(user, team, channelId, dto);
  }

  @Delete(':channelId')
  @MinRole(TeamRole.ADMIN)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('channelId') channelId: string,
  ) {
    return this.alerts.deleteChannel(user, team, channelId);
  }
}
