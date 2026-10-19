import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { UpdateProfileDto } from './auth.dto';
import { CurrentUser, Public } from '../common/decorators';
import type { AuthenticatedUser } from '../common/types';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated profile and team memberships' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.sync(user);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Create/refresh the local profile after Supabase authentication' })
  sync(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.sync(user);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the current user profile' })
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user, dto);
  }

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Public authentication capability flags' })
  config() {
    return { provider: 'supabase', emailVerificationRequired: true };
  }
}
