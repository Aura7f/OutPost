import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EgressMode, MonitorMethod, RunStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMonitorDto {
  @ApiProperty({ example: 'Public API health' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiProperty({ example: 'https://api.example.com/health' })
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'], require_tld: false })
  @MaxLength(2048)
  url: string;

  @ApiPropertyOptional({ enum: MonitorMethod, default: MonitorMethod.GET })
  @IsOptional()
  @IsEnum(MonitorMethod)
  method?: MonitorMethod;

  @ApiPropertyOptional({ type: [Number], default: [200] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(100, { each: true })
  @Max(599, { each: true })
  expectedStatusCodes?: number[];

  @ApiPropertyOptional({ minimum: 1000, maximum: 30000, default: 10000 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(30000)
  timeoutMs?: number;

  @ApiPropertyOptional({ minimum: 60, maximum: 86400, default: 300, description: 'Seconds between checks' })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  intervalSeconds?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  failureThreshold?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    enum: EgressMode,
    default: EgressMode.DEFAULT,
    description: 'Where the outbound check originates: API host, proxy pool, or a checker region',
  })
  @IsOptional()
  @IsEnum(EgressMode)
  egressMode?: EgressMode;

  @ApiPropertyOptional({
    description: 'Checker region id. Required when egressMode is REGION.',
    example: 'ap-south-1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string;

  @ApiPropertyOptional({ description: 'Optional service id within the same project' })
  @IsOptional()
  @IsString()
  serviceId?: string;
}

export class UpdateMonitorDto extends PartialType(CreateMonitorDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class MonitorRunQueryDto {
  @ApiPropertyOptional({ enum: RunStatus })
  @IsOptional()
  @IsEnum(RunStatus)
  status?: RunStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class MonitorStatsQueryDto {
  @ApiPropertyOptional({ enum: ['24h', '7d', '30d', '90d'], default: '24h' })
  @IsOptional()
  @IsIn(['24h', '7d', '30d', '90d'])
  range?: '24h' | '7d' | '30d' | '90d';
}

export class HealthOverviewQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;
}

export class HealthRunsQueryDto extends MonitorRunQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  monitorId?: string;
}
