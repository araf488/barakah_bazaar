import { PartialType } from '@nestjs/swagger';
import { CreateAddressDto } from './create-address.dto';

/**
 * A partial edit. Fields left out are left alone — Prisma reads `undefined` in `data` as
 * "do not touch", so a patch cannot blank a column it never mentioned.
 *
 * `PartialType` comes from `@nestjs/swagger` rather than `@nestjs/mapped-types` so the
 * OpenAPI metadata survives; the storefront generates its client from that document.
 *
 * Geography is still validated as a whole: the service merges the patch onto the stored row
 * before asking GeoService, so changing only the area cannot slip a broken chain past.
 */
export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
