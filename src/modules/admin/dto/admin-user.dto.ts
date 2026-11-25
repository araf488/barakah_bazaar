import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Language, UserRole } from '../../../infra/prisma/prisma-client';
import { AuthConstants } from '../../auth/auth.constants';
import { AdminConstants } from '../admin.constants';

/** A user as staff see them — more than the customer's own profile exposes. */
export class AdminUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true }) fullName!: string | null;
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiProperty() isActive!: boolean;
  @ApiPropertyOptional({ nullable: true }) lastSeenAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class AdminUserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches email, phone or name' })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(AdminConstants.MaxUserSearchLength)
  search?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Restrict to enabled or disabled accounts' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}

/** Changing a staff role. One write: the `role` column is where a role lives. */
export class ChangeRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role!: UserRole;
}

/** Support opening a customer account on someone's behalf. No password: the customer sets it. */
export class CreateCustomerDto {
  @ApiProperty({ example: 'aisha@example.com' })
  @TrimString()
  @IsEmail()
  @MaxLength(AdminConstants.EmailMaxLength)
  email!: string;

  @ApiProperty({ example: 'Aisha Rahman' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AuthConstants.FullNameMaxLength)
  fullName!: string;

  @ApiPropertyOptional({ enum: Language, description: 'Defaults to BN' })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language;
}

/** The created account, and whether the set-your-password email was handed off. */
export class CustomerCreatedDto {
  @ApiProperty({ type: AdminUserDto }) user!: AdminUserDto;
  @ApiProperty() passwordSetupEmailQueued!: boolean;
}
