import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';
import { CurrentTeam, CurrentUser, TeamScoped } from '../common/decorators';
import type { AuthenticatedUser, TeamContext } from '../common/types';
import { InviteMemberDto, AcceptInvitationDto } from '../teams/teams.dto';

@ApiTags('Invitations')
@ApiBearerAuth()
@TeamScoped()
@Controller('teams/:teamId/invitations')
export class TeamInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @ApiOperation({ summary: 'List pending invitations' })
  list(@CurrentTeam() team: TeamContext) {
    return this.invitations.list(team);
  }

  @Post()
  @ApiOperation({ summary: 'Invite a member by email through Resend' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Body() dto: InviteMemberDto,
  ) {
    return this.invitations.create(user, team, dto);
  }

  @Post(':invitationId/resend')
  resend(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.resend(user, team, invitationId);
  }

  @Delete(':invitationId')
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTeam() team: TeamContext,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.revoke(user, team, invitationId);
  }
}

@ApiTags('Invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get('pending')
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.invitations.pendingForUser(user);
  }

  @Get(':token')
  preview(@CurrentUser() user: AuthenticatedUser, @Param('token') token: string) {
    return this.invitations.preview(user, token);
  }

  @Post('accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(user, dto.token);
  }

  @Post('decline')
  decline(@CurrentUser() user: AuthenticatedUser, @Body() dto: AcceptInvitationDto) {
    return this.invitations.decline(user, dto.token);
  }
}
