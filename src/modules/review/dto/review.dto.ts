import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ReviewStatus } from '../../../infra/prisma/prisma-client';
import { TrimString } from '../../../common/dto/trim.decorator';
import { ReviewConstants } from '../review.constants';

export class CreateReviewDto {
  @ApiProperty({ format: 'uuid', description: 'The delivered order line being reviewed.' })
  @IsUUID()
  orderItemId!: string;

  @ApiProperty({ minimum: ReviewConstants.MinRating, maximum: ReviewConstants.MaxRating })
  @Type(() => Number)
  @IsInt()
  @Min(ReviewConstants.MinRating)
  @Max(ReviewConstants.MaxRating)
  rating!: number;

  @ApiPropertyOptional({ maxLength: ReviewConstants.MaxTitleLength })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(ReviewConstants.MaxTitleLength)
  title?: string | null;

  @ApiPropertyOptional({ maxLength: ReviewConstants.MaxBodyLength })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(ReviewConstants.MaxBodyLength)
  body?: string | null;
}

export class ModerateReviewDto {
  @ApiPropertyOptional({
    maxLength: ReviewConstants.MaxModerationNoteLength,
    description: 'Internal note. Never shown to the customer.',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(ReviewConstants.MaxModerationNoteLength)
  note?: string | null;
}

export class ReviewQueryDto {
  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: ReviewConstants.MaxPageSize })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ReviewConstants.MaxPageSize)
  pageSize?: number;
}

/**
 * A published review as the storefront sees it.
 *
 * No `userId`, no `orderItemId`, no moderation fields. Which order a review came from would
 * let anyone correlate a review with a purchase, and the moderation note is written for staff.
 */
export class ReviewDto {
  @ApiProperty() id!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() rating!: number;
  @ApiPropertyOptional({ nullable: true }) title!: string | null;
  @ApiPropertyOptional({ nullable: true }) body!: string | null;
  @ApiProperty({ description: 'Always true: a review can only come from a delivered line.' })
  isVerifiedPurchase!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

/** The staff view, which does carry the moderation trail. */
export class AdminReviewDto extends ReviewDto {
  @ApiProperty({ enum: ReviewStatus }) status!: ReviewStatus;
  @ApiProperty() userId!: string;
  @ApiPropertyOptional({ nullable: true }) moderatedBy!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  moderatedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) moderationNote!: string | null;
}

export class ReviewListDto {
  @ApiProperty({ type: [ReviewDto] }) items!: ReviewDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class AdminReviewListDto {
  @ApiProperty({ type: [AdminReviewDto] }) items!: AdminReviewDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
