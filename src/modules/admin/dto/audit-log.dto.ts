import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { UserRole } from '../../../infra/prisma/prisma-client';
import { AdminAuditActions, AdminAuditEntities } from '../admin.constants';

/** One recorded staff action. */
export class AuditLogEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) actorId!: string;
  @ApiPropertyOptional({ nullable: true }) actorEmail!: string | null;
  @ApiProperty({ enum: UserRole }) actorRole!: UserRole;
  @ApiProperty({ example: 'product.published' }) action!: string;
  @ApiProperty({ example: 'Product' }) entityType!: string;
  @ApiPropertyOptional({ nullable: true }) entityId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Object }) before!: unknown;
  @ApiPropertyOptional({ nullable: true, type: Object }) after!: unknown;
  @ApiPropertyOptional({ nullable: true }) requestId!: string | null;
  @ApiProperty() createdAt!: Date;
}

/** Filters for the audit trail. Every field narrows; none widens. */
export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Object.values(AdminAuditActions) })
  @IsOptional()
  @IsIn(Object.values(AdminAuditActions))
  action?: string;

  @ApiPropertyOptional({ enum: Object.values(AdminAuditEntities) })
  @IsOptional()
  @IsIn(Object.values(AdminAuditEntities))
  entityType?: string;

  @ApiPropertyOptional({ description: 'All entries touching one record' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'All entries by one staff member' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorId?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound, ISO 8601' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclusive upper bound, ISO 8601' })
  @IsOptional()
  @IsISO8601()
  until?: string;
}
