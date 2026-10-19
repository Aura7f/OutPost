import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TeamRole } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({ example: 'Acme Engineering' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(64)
  name: string;
}

export class UpdateTeamDto {
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ minimum: 7, maximum: 3650, description: 'Monitoring history retention in days' })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(3650)
  retentionDays?: number;
}

export class DeleteTeamDto {
  @ApiProperty({ description: 'Type the exact team name to confirm permanent deletion' })
  @IsString()
  @IsNotEmpty()
  confirmName: string;
}

export class InviteMemberDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ enum: [TeamRole.ADMIN, TeamRole.VIEWER], default: TeamRole.VIEWER })
  @IsEnum(TeamRole)
  role: TeamRole;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: [TeamRole.ADMIN, TeamRole.VIEWER] })
  @IsEnum(TeamRole)
  role: TeamRole;
}

export class TransferOwnershipDto {
  @ApiProperty({ description: 'TeamMember id of the new owner' })
  @IsString()
  @IsNotEmpty()
  memberId: string;
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;
}
