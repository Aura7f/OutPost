import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorSeverity, ErrorStatus, Environment } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.dto';

export class IngestErrorEventDto {
  @ApiProperty({ example: 'TypeError' })
  @IsString()
  @MaxLength(160)
  errorType: string;

  @ApiProperty({ example: 'Cannot read properties of undefined (reading id)' })
  @IsString()
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16000)
  stackTrace?: string;

  @ApiProperty({ example: 'checkout-api' })
  @IsString()
  @MaxLength(120)
  serviceName: string;

  @ApiPropertyOptional({ enum: Environment, default: Environment.PRODUCTION })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  environment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(599)
  httpStatus?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  path?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @ApiPropertyOptional({ enum: ErrorSeverity })
  @IsOptional()
  @IsEnum(ErrorSeverity)
  severity?: ErrorSeverity;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class IngestErrorsDto {
  @ApiProperty({ type: [IngestErrorEventDto], maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => IngestErrorEventDto)
  events: IngestErrorEventDto[];
}

export class ErrorGroupsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ enum: ErrorStatus })
  @IsOptional()
  @IsEnum(ErrorStatus)
  status?: ErrorStatus;

  @ApiPropertyOptional({ enum: ErrorSeverity })
  @IsOptional()
  @IsEnum(ErrorSeverity)
  severity?: ErrorSeverity;

  @ApiPropertyOptional({ enum: Environment })
  @IsOptional()
  @IsEnum(Environment)
  environment?: Environment;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class UpdateErrorGroupDto {
  @ApiProperty({ enum: ErrorStatus })
  @IsEnum(ErrorStatus)
  status: ErrorStatus;
}

export class ErrorEventsQueryDto extends PaginationQueryDto {}

export class ErrorOverviewQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;
}
