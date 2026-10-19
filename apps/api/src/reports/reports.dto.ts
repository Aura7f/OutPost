import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportFrequency, ReportType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
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
import { PaginationQueryDto } from '../common/pagination.dto';

export class CreateReportDto {
  @ApiProperty()
  @IsString()
  projectId: string;

  @ApiProperty({ enum: ReportType, default: ReportType.CUSTOM })
  @IsEnum(ReportType)
  type: ReportType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ type: [String], description: 'Optional recipients emailed after generation' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEmail({}, { each: true })
  emailRecipients?: string[];
}

export class ReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ enum: ReportType })
  @IsOptional()
  @IsEnum(ReportType)
  type?: ReportType;
}

export class EmailReportDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsEmail({}, { each: true })
  recipients: string[];
}

export class CreateReportShareDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 365, default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class CreateReportScheduleDto {
  @ApiProperty()
  @IsString()
  projectId: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: ReportFrequency })
  @IsEnum(ReportFrequency)
  frequency: ReportFrequency;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsEmail({}, { each: true })
  recipients: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateReportScheduleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: ReportFrequency })
  @IsOptional()
  @IsEnum(ReportFrequency)
  frequency?: ReportFrequency;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEmail({}, { each: true })
  recipients?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
