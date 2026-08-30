import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  Language,
  NotificationChannel,
  NotificationStatus,
} from '../../../infra/prisma/prisma-client';
import { NotificationConstants } from '../notification.constants';

export class NotificationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: NotificationConstants.MaxPageSize })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NotificationConstants.MaxPageSize)
  pageSize?: number;
}

/**
 * One recorded message.
 *
 * Deliberately no body: bodies are not stored, so the client renders its own copy from the
 * template id if it wants to show one.
 */
export class NotificationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NotificationChannel }) channel!: NotificationChannel;
  @ApiProperty({ description: 'Key into the template catalogue, e.g. "order.dispatched".' })
  templateId!: string;
  @ApiProperty({ enum: Language }) language!: Language;
  @ApiProperty({ enum: NotificationStatus }) status!: NotificationStatus;
  @ApiPropertyOptional({ nullable: true }) referenceType!: string | null;
  @ApiPropertyOptional({ nullable: true }) referenceId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  sentAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto] }) items!: NotificationDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
