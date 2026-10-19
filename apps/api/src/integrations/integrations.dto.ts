import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HeartbeatStatus, IntegrationType } from '@prisma/client';
import { PaginationQueryDto } from '../common/pagination.dto';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateIntegrationDto {
  @ApiProperty({ example: 'Production Supabase' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ enum: [IntegrationType.SUPABASE, IntegrationType.POSTGRESQL], default: IntegrationType.SUPABASE })
  @IsOptional()
  @IsEnum(IntegrationType)
  type?: IntegrationType;

  @ApiPropertyOptional({ example: 'https://abcdefghijkl.supabase.co' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'], require_tld: true })
  @MaxLength(1000)
  supabaseUrl?: string;

  @ApiPropertyOptional({ description: 'Supabase publishable/anon key. Service-role and secret keys are rejected.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  apiKey?: string;

  @ApiPropertyOptional({ description: 'Least-privilege PostgreSQL connection string for database metrics' })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  databaseUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  heartbeatEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 5, maximum: 10080, default: 15 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(10080)
  heartbeatIntervalMinutes?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  metricsEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 5, maximum: 10080, default: 15 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(10080)
  metricsIntervalMinutes?: number;
}

export class UpdateIntegrationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  heartbeatEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 5, maximum: 10080 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(10080)
  heartbeatIntervalMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  metricsEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 5, maximum: 10080 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(10080)
  metricsIntervalMinutes?: number;
}

export class RotateCredentialsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'], require_tld: true })
  @MaxLength(1000)
  supabaseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  databaseUrl?: string;
}

export class HeartbeatHistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: HeartbeatStatus })
  @IsOptional()
  @IsEnum(HeartbeatStatus)
  status?: HeartbeatStatus;
}
