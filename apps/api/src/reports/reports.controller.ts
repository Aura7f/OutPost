import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import {
  CreateReportDto,
  CreateReportScheduleDto,
  CreateReportShareDto,
  EmailReportDto,
  ReportsQueryDto,
  UpdateReportScheduleDto,
} from './reports.dto';
import { CurrentTeam, CurrentUser, MinRole, Public, TeamScoped } from '../common/decorators';
import type { AuthenticatedUser, TeamContext } from '../common/types';

@ApiTags('Reports')
@ApiBearerAuth()
@TeamScoped()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@CurrentTeam() team: TeamContext, @Query() query: ReportsQueryDto) {
    return this.reports.list(team, query);
  }

  @Post()
  @MinRole(TeamRole.ADMIN)
  @ApiOperation({ summary: 'Generate a PDF report from real monitoring data' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Body() dto: CreateReportDto,
  ) {
    return this.reports.create(user, team, dto);
  }

  @Get(':reportId')
  get(@CurrentTeam() team: TeamContext, @Param('reportId') reportId: string) {
    return this.reports.get(team, reportId);
  }

  @Get(':reportId/download')
  async download(
    @CurrentTeam() team: TeamContext,
    @Param('reportId') reportId: string,
    @Res() response: Response,
  ) {
    const file = await this.reports.download(team, reportId);
    response
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
      .setHeader('Cache-Control', 'private, no-store')
      .send(file.buffer);
  }

  @Post(':reportId/email')
  @MinRole(TeamRole.ADMIN)
  email(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('reportId') reportId: string,
    @Body() dto: EmailReportDto,
  ) {
    return this.reports.emailReport(user, team, reportId, dto);
  }

  @Get(':reportId/shares')
  shares(@CurrentTeam() team: TeamContext, @Param('reportId') reportId: string) {
    return this.reports.shares(team, reportId);
  }

  @Post(':reportId/shares')
  @MinRole(TeamRole.ADMIN)
  @ApiOperation({ summary: 'Create an expiring read-only report link; the URL is shown once' })
  createShare(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('reportId') reportId: string,
    @Body() dto: CreateReportShareDto,
  ) {
    return this.reports.createShare(user, team, reportId, dto.expiresInDays ?? 7);
  }

  @Delete(':reportId/shares/:shareId')
  @MinRole(TeamRole.ADMIN)
  revokeShare(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('reportId') reportId: string,
    @Param('shareId') shareId: string,
  ) {
    return this.reports.revokeShare(user, team, reportId, shareId);
  }
}

@ApiTags('Reports')
@ApiBearerAuth()
@TeamScoped()
@Controller('report-schedules')
export class ReportSchedulesController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(
    @CurrentTeam() team: TeamContext,
    @Query('projectId') projectId?: string,
  ) {
    return this.reports.schedules(team, projectId);
  }

  @Post()
  @MinRole(TeamRole.ADMIN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Body() dto: CreateReportScheduleDto,
  ) {
    return this.reports.createSchedule(user, team, dto);
  }

  @Patch(':scheduleId')
  @MinRole(TeamRole.ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('scheduleId') scheduleId: string,
    @Body() dto: UpdateReportScheduleDto,
  ) {
    return this.reports.updateSchedule(user, team, scheduleId, dto);
  }

  @Delete(':scheduleId')
  @MinRole(TeamRole.ADMIN)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('scheduleId') scheduleId: string,
  ) {
    return this.reports.deleteSchedule(user, team, scheduleId);
  }
}

@ApiTags('Public report shares')
@Controller('public/reports')
export class PublicReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Public()
  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  view(@Param('token') token: string) {
    return this.reports.resolvePublicShare(token);
  }

  @Public()
  @Get(':token/pdf')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async download(@Param('token') token: string, @Res() response: Response) {
    const file = await this.reports.publicPdf(token);
    response
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Disposition', `inline; filename="${file.filename}"`)
      .setHeader('Cache-Control', 'private, no-store')
      .setHeader('X-Robots-Tag', 'noindex, nofollow')
      .send(file.buffer);
  }
}
