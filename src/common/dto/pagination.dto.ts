import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationDefaults } from '../constants/app.constants';

/** Query parameters shared by every list endpoint. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: PaginationDefaults.Page })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = PaginationDefaults.Page;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: PaginationDefaults.MaxLimit,
    default: PaginationDefaults.Limit,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PaginationDefaults.MaxLimit)
  limit: number = PaginationDefaults.Limit;

  /** Rows to skip, derived from page/limit. */
  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export class PaginationMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalItems!: number;
  @ApiProperty() totalPages!: number;
  @ApiProperty() hasNextPage!: boolean;
}

/** Envelope for paginated list responses. */
export class PaginatedResponseDto<TItem> {
  @ApiProperty({ isArray: true })
  items!: TItem[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;

  static of<TItem>(
    items: TItem[],
    totalItems: number,
    page: number,
    limit: number,
  ): PaginatedResponseDto<TItem> {
    const totalPages = limit > 0 ? Math.ceil(totalItems / limit) : 0;
    return {
      items,
      meta: { page, limit, totalItems, totalPages, hasNextPage: page < totalPages },
    };
  }
}
