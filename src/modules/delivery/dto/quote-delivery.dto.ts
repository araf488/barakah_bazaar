import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';

export class QuoteDeliveryDto {
  @ApiProperty()
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  division!: string;

  @ApiProperty()
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  district!: string;

  @ApiProperty({ description: 'Upazila, city thana or circle.' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  unit!: string;

  @ApiProperty({ description: 'Basket value in poysha, used for free-delivery thresholds.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  subtotalPoysha!: number;
}
