import { Module } from '@nestjs/common';
import { TeamsController, TeamManagementController } from './teams.controller';
import { TeamsService } from './teams.service';
import { InvitationsController, TeamInvitationsController } from '../invitations/invitations.controller';
import { InvitationsService } from '../invitations/invitations.service';

@Module({
  controllers: [TeamsController, TeamManagementController, TeamInvitationsController, InvitationsController],
  providers: [TeamsService, InvitationsService],
  exports: [TeamsService, InvitationsService],
})
export class TeamsModule {}
