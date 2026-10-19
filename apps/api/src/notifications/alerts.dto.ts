import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertEventType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateAlertRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEmail({}, { each: true })
  recipients?: string[];

  @ApiPropertyOptional({ minimum: 5, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  cooldownMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  failureThreshold?: number;

  @ApiPropertyOptional({ minimum: 100, maximum: 60000 })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(60000)
  latencyThresholdMs?: number;
}

export class CreateAlertRuleDto extends UpdateAlertRuleDto {
  @ApiProperty()
  @IsString()
  projectId: string;

  @ApiProperty({ enum: AlertEventType })
  @IsEnum(AlertEventType)
  type: AlertEventType;
}

export class TestAlertDto {
  @ApiProperty()
  @IsString()
  projectId: string;

  @ApiProperty()
  @IsEmail()
  recipient: string;
}

export class CreateChannelDto {
  @ApiProperty({ example: 'On-call email' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiProperty({ type: [String], description: 'Team-wide recipient addresses' })
  @IsArray()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  emails: string[];
}

export class UpdateChannelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  emails?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
