import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, ProductVariant, Warehouse } from '../../src/infra/prisma/prisma-client';
import { OrderDto } from '../../src/modules/order/dto/order.dto';
import { authHeaders } from './auth-fixtures';

/** A hub with one published, in-stock variant: everything an order needs to be placed. */
export interface SeededStore {
  hub: Warehouse;
  variant: ProductVariant;
}

/** Unit price of the seeded variant, in poysha. */
export const STORE_UNIT_PRICE_POYSHA = 15_000n;

/** Units on the shelf, plenty for every order a suite places. */
const STORE_STOCK_UNITS = 100;

/** Where the seeded hub and every seeded address are, a place in the vendored geography. */
const STORE_DIVISION = 'Dhaka';
const STORE_DISTRICT = 'Dhaka';
const STORE_UNIT = 'Savar';

/** A normalised copy of this is what an order's `phone` and the SMS recipient become. */
export const ADDRESS_PHONE_LOCAL = '01712345678';
export const ADDRESS_PHONE_E164 = '+8801712345678';

/**
 * Hubs, and the catalogue under the categories, are not cleared by `resetDatabase` (it clears
 * identity tables, and orders and payments with them). A suite that seeds a store clears these
 * itself, before and after.
 */
export const clearStore = async (prisma: PrismaClient): Promise<void> => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "public"."warehouses" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "public"."categories" CASCADE');
};

/** Writes one hub, one published product with one variant, and stock for it. */
export const seedStore = async (prisma: PrismaClient): Promise<SeededStore> => {
  const hub = await prisma.warehouse.create({
    data: {
      code: 'DHK-BKS',
      nameEn: 'bKash Hub',
      division: STORE_DIVISION,
      district: STORE_DISTRICT,
      upazila: STORE_UNIT,
      addressLine: 'House 1, Road 1',
    },
  });
  const category = await prisma.category.create({
    data: { slug: 'e2e-bkash', nameEn: 'bKash', nameBn: 'বিকাশ' },
  });
  const product = await prisma.product.create({
    data: {
      slug: 'e2e-bkash-product',
      nameEn: 'bKash Product',
      nameBn: 'বিকাশ পণ্য',
      categoryId: category.id,
      publishedAt: new Date(),
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: 'E2E-BKS-1',
      nameEn: '1 kg',
      nameBn: '১ কেজি',
      pricePoysha: STORE_UNIT_PRICE_POYSHA,
      unitLabel: '1kg',
    },
  });
  await prisma.inventory.create({
    data: { warehouseId: hub.id, variantId: variant.id, quantityOnHand: STORE_STOCK_UNITS },
  });

  return { hub, variant };
};

/**
 * Places a BKASH order the way a customer does, through the real API: saves an address, puts
 * the variant in the basket, then `POST /orders`. Any step that does not answer as expected
 * throws with the response, so a broken fixture never looks like a failing assertion.
 */
export const placeBkashOrder = async (
  app: INestApplication,
  session: { accessToken: string; deviceId: string },
  variantId: string,
  quantity = 1,
): Promise<OrderDto> => {
  const headers = authHeaders(session.accessToken, session.deviceId);
  const server = app.getHttpServer();

  const address = await request(server).post('/api/v1/users/me/addresses').set(headers).send({
    recipientName: 'Rahim Uddin',
    phone: ADDRESS_PHONE_LOCAL,
    division: STORE_DIVISION,
    district: STORE_DISTRICT,
    unit: STORE_UNIT,
    addressLine: 'House 12, Road 4',
  });
  expectStatus(address, 201, 'save the address');

  const cart = await request(server)
    .post('/api/v1/cart/items')
    .set(headers)
    .send({ variantId, quantity });
  expectStatus(cart, 200, 'add to the basket');

  const placed = await request(server)
    .post('/api/v1/orders')
    .set(headers)
    .send({ addressId: address.body.id, paymentMethod: 'BKASH' });
  expectStatus(placed, 201, 'place the order');

  return placed.body as OrderDto;
};

const expectStatus = (response: request.Response, expected: number, step: string): void => {
  if (response.status !== expected) {
    throw new Error(
      `Could not ${step}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
};
