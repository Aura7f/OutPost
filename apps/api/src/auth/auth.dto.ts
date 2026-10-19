import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(500)
  avatarUrl?: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}

export class SignupDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  fullName?: string;

  @ApiPropertyOptional({ description: 'Relative web path to return to after verification' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  next?: string;
}

export class RecoverPasswordDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ResendVerificationDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ExchangeSessionDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(8192)
  accessToken!: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  refreshToken!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
