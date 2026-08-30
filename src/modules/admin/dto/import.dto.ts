import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminConstants } from '../admin.constants';

/**
 * A CSV upload.
 *
 * The file arrives as text in the body rather than multipart: an import is capped at
 * ~1 MB, the admin portal already holds the file contents to preview them, and a JSON body
 * keeps the same validation pipeline as every other route.
 */
export class ImportProductsDto {
  @ApiProperty({
    description: 'The CSV document, headers on the first line',
    example:
      'slug,nameEn,nameBn,categorySlug,sku,variantNameEn,variantNameBn,pricePoysha,unitLabel',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(AdminConstants.MaxImportBytes)
  csv!: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Validate and report without writing anything',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dryRun?: boolean;
}

/** One thing wrong with one row, addressed the way the operator sees their file. */
export class ImportIssueDto {
  @ApiProperty({ example: 14, description: '1-based line in the uploaded file' })
  line!: number;
  @ApiPropertyOptional({ nullable: true, example: 'pricePoysha' }) column!: string | null;
  @ApiProperty({ example: 'pricePoysha must be a whole number of poysha above zero' })
  message!: string;
}

/** What the import did, or would do. */
export class ImportReportDto {
  @ApiProperty({ description: 'True when nothing was written' }) dryRun!: boolean;
  @ApiProperty({ description: 'True when the catalog was changed' }) applied!: boolean;
  @ApiProperty() totalRows!: number;
  @ApiProperty() productsCreated!: number;
  @ApiProperty() variantsCreated!: number;
  @ApiProperty({ type: [ImportIssueDto] }) issues!: ImportIssueDto[];
}
