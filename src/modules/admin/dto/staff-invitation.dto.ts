import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { StaffInvitationStatus, UserRole } from '../../../infra/prisma/prisma-client';
import { TrimString } from '../../../common/dto/trim.decorator';
import { AdminConstants } from '../admin.constants';

export class InviteStaffDto {
  @ApiProperty({ description: 'Where the invitation is sent. Lowercased before storage.' })
  @TrimString()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ enum: UserRole, description: 'The role this invitation grants on acceptance.' })
  @IsEnum(UserRole)
  role!: UserRole;
}

export class AcceptInvitationDto {
  @ApiProperty({ description: 'The token from the invitation email.' })
  @TrimString()
  @IsString()
  @MaxLength(200)
  token!: string;
}

export class InvitationQueryDto {
  @ApiPropertyOptional({ enum: StaffInvitationStatus })
  @IsOptional()
  @IsEnum(StaffInvitationStatus)
  status?: StaffInvitationStatus;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: AdminConstants.MaxInvitationPageSize })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

/**
 * One invitation.
 *
 * There is deliberately no token field. The raw token exists once, in the email; the stored
 * hash is never returned, so a compromised staff account cannot read back a pending grant and
 * accept it themselves.
 */
export class StaffInvitationDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiProperty({ enum: StaffInvitationStatus }) status!: StaffInvitationStatus;
  @ApiProperty({
    description: 'True when the deadline has passed. Derived, never stored as a status.',
  })
  isExpired!: boolean;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty() invitedBy!: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  acceptedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  revokedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

/**
 * What the invite endpoint answers with.
 *
 * `token` is present ONLY while `EMAIL_PROVIDER=noop`, so the flow can be completed in
 * development without a mailbox. With a real provider it is null and the token never leaves
 * the email.
 */
export class InvitationCreatedDto {
  @ApiProperty({ type: StaffInvitationDto }) invitation!: StaffInvitationDto;
  @ApiProperty({ description: 'True when the email was accepted for delivery.' })
  emailSent!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Development only: the raw token, returned while no email provider is configured.',
  })
  token!: string | null;
}

export class InvitationListDto {
  @ApiProperty({ type: [StaffInvitationDto] }) items!: StaffInvitationDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
