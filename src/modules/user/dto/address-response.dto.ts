import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A saved delivery address.
 *
 * Deliberately narrower than the table: `userId` is implicit (you can only ever see your
 * own) and `deletedAt` is an implementation detail of soft delete that must never leave the
 * server.
 *
 * `unit` is the level below district — an upazila, a city thana (Gulshan, Motijheel) or a
 * development circle (Tejgaon). It is stored in the `upazila` column, which predates city
 * coverage; the API uses `unit` because that is what `GET /geo/districts/:district/units`
 * returns, and a client should post back the field name it was given.
 */
export class AddressDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Home' }) label!: string | null;
  @ApiProperty({ example: 'Rahim Uddin' }) recipientName!: string;
  @ApiProperty({ example: '+8801712345678' }) phone!: string;
  @ApiProperty({ example: 'Dhaka' }) division!: string;
  @ApiProperty({ example: 'Dhaka' }) district!: string;
  @ApiProperty({ example: 'Gulshan', description: 'Upazila, city thana or circle' })
  unit!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Gulshan Model Town' })
  area!: string | null;
  @ApiProperty({ example: 'House 12, Road 4' }) addressLine!: string;
  @ApiPropertyOptional({ nullable: true, example: '1212' }) postCode!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 23.7925 }) latitude!: number | null;
  @ApiPropertyOptional({ nullable: true, example: 90.4078 }) longitude!: number | null;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
