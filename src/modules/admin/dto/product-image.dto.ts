import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { AdminConstants } from '../admin.constants';

/** Asks for a signed URL to PUT a file straight to Storage. */
export class ImageUploadUrlDto {
  @ApiProperty({ example: 'almonds-500g.jpg' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fileName!: string;

  @ApiProperty({ enum: AdminConstants.AllowedImageTypes, example: 'image/jpeg' })
  @IsIn(AdminConstants.AllowedImageTypes)
  contentType!: string;
}

/** What the client needs to upload, and the URL to register afterwards. */
export class ImageUploadUrlResponseDto {
  @ApiProperty({ description: 'PUT the file here' }) signedUrl!: string;
  @ApiProperty() token!: string;
  @ApiProperty() expiresInSeconds!: number;
  @ApiProperty({ description: 'Send this back to POST …/images once the upload succeeds' })
  objectPath!: string;
}

export class AddProductImageDto {
  @ApiProperty({ description: 'The objectPath returned when the upload URL was issued' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  objectPath!: string;

  @ApiPropertyOptional({ maxLength: AdminConstants.MaxAltTextLength })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(AdminConstants.MaxAltTextLength)
  altText?: string | null;

  @ApiPropertyOptional({ default: false, description: 'Make this the product tile image' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateProductImageDto {
  @ApiPropertyOptional({ maxLength: AdminConstants.MaxAltTextLength })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(AdminConstants.MaxAltTextLength)
  altText?: string | null;

  @ApiPropertyOptional({ description: 'Lower sorts first' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ProductImageDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() url!: string;
  @ApiPropertyOptional({ nullable: true }) altText!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isPrimary!: boolean;
  @ApiProperty() createdAt!: Date;
}
