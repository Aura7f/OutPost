import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Environment } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'Payments API' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: Environment, default: Environment.PRODUCTION })
  @IsOptional()
  @IsEnum(Environment)
  environment?: Environment;
}

export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: Environment })
  @IsOptional()
  @IsEnum(Environment)
  environment?: Environment;
}

export class CreateServiceDto {
  @ApiProperty({ example: 'checkout-api' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: Environment })
  @IsOptional()
  @IsEnum(Environment)
  environment?: Environment;

  @ApiPropertyOptional({ example: 'node' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  runtime?: string;
}

export class UpdateServiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: Environment })
  @IsOptional()
  @IsEnum(Environment)
  environment?: Environment;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  runtime?: string;
}
