import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ProductSort, ProductSortOption } from '../catalog.constants';

const MAX_FILTER_LENGTH = 120;

/** Filters for the public product list. */
export class ProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Restrict to one category, by slug' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FILTER_LENGTH)
  categorySlug?: string;

  @ApiPropertyOptional({ description: 'Free-text match on English or Bangla name' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FILTER_LENGTH)
  search?: string;

  @ApiPropertyOptional({ description: 'Only perishable items (doi, rosmalai, fresh fruit)' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  perishableOnly?: boolean;

  @ApiPropertyOptional({
    enum: Object.values(ProductSortOption),
    default: ProductSortOption.Newest,
  })
  @IsOptional()
  @IsEnum(ProductSortOption)
  sort: ProductSort = ProductSortOption.Newest;
}
