import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../../infra/prisma/prisma-client';

/** The caller's own profile. Never exposes another user's row. */
export class UserProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Supabase Auth user id' })
  supabaseUserId!: string;

  @ApiPropertyOptional({ nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  fullName?: string | null;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty()
  createdAt!: Date;
}
