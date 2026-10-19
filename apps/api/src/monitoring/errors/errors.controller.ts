import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TeamRole } from '@prisma/client';
import { ErrorsService } from './errors.service';
import {
  ErrorEventsQueryDto,
  ErrorGroupsQueryDto,
  ErrorOverviewQueryDto,
  IngestErrorsDto,
  UpdateErrorGroupDto,
} from './errors.dto';
import { CurrentTeam, CurrentUser, MinRole, Public, TeamScoped } from '../../common/decorators';
import type { AuthenticatedUser, TeamContext } from '../../common/types';

@ApiTags('Error ingestion')
@Controller('ingest')
export class ErrorIngestionController {
  constructor(private readonly errors: ErrorsService) {}

  @Public()
  @Post('errors')
  @HttpCode(202)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Ingest sanitized application errors with a project ingestion key',
    description:
      'Public endpoint authenticated by X-Outpost-Key. Never send request bodies, credentials, or user secrets.',
  })
  ingest(
    @Headers('x-outpost-key') ingestionKey: string | undefined,
    @Body() dto: IngestErrorsDto,
  ) {
    return this.errors.ingest(ingestionKey, dto);
  }
}

@ApiTags('Errors')
@ApiBearerAuth()
@TeamScoped()
@Controller('errors')
export class ErrorsController {
  constructor(private readonly errors: ErrorsService) {}

  @Get('overview')
  overview(@CurrentTeam() team: TeamContext, @Query() query: ErrorOverviewQueryDto) {
    return this.errors.overview(team, query.projectId);
  }

  @Get('groups')
  groups(@CurrentTeam() team: TeamContext, @Query() query: ErrorGroupsQueryDto) {
    return this.errors.groups(team, query);
  }

  @Get('groups/:groupId')
  get(@CurrentTeam() team: TeamContext, @Param('groupId') groupId: string) {
    return this.errors.get(team, groupId);
  }

  @Get('groups/:groupId/events')
  events(
    @CurrentTeam() team: TeamContext,
    @Param('groupId') groupId: string,
    @Query() query: ErrorEventsQueryDto,
  ) {
    return this.errors.events(team, groupId, query);
  }

  @Patch('groups/:groupId')
  @MinRole(TeamRole.ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateErrorGroupDto,
  ) {
    return this.errors.updateStatus(user, team, groupId, dto);
  }
}
