import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Cart, CartItem, Prisma } from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** `undefined` = no such row for this owner; `null` = the query failed. */
export type CartItemResult = CartItem | null | undefined;

const cartInclude = {
  items: {
    include: {
      variant: {
        include: {
          product: {
            select: {
              slug: true,
              nameEn: true,
              nameBn: true,
              isActive: true,
              publishedAt: true,
              // Cold-chain handling. Checkout refuses a hub that cannot reach the address
              // within a perishable's limit, so these have to travel with the basket rather
              // than be fetched again per line.
              isPerishable: true,
              maxDeliveryDistanceKm: true,
              storageType: true,
              images: { where: { isPrimary: true }, select: { url: true }, take: 1 },
            },
          },
        },
      },
    },
    orderBy: { addedAt: 'asc' },
  },
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
export type CartLine = CartWithItems['items'][number];

/**
 * Basket persistence.
 *
 * Every read and write is scoped by the owner's user id in the predicate, never by comparing
 * after a fetch — the same rule the address book follows, for the same reason.
 */
@Injectable()
export class CartRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(CartRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * The customer's basket, created on first sight.
   *
   * An upsert rather than find-then-create: two tabs adding an item at once would otherwise
   * race, and `user_id` is unique so the second insert would fail rather than reuse the first.
   */
  async findOrCreate(userId: string): Promise<CartWithItems | null> {
    try {
      return await this.prisma.cart.upsert({
        where: { userId },
        create: { user: { connect: { id: userId } } },
        update: {},
        include: cartInclude,
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        'Exception occurred in CartRepository.findOrCreate',
      );
      return null;
    }
  }

  /**
   * Adds a line, or raises the quantity of the one already there.
   *
   * The unique `(cart_id, variant_id)` index makes this an upsert: adding the same item twice
   * must raise the quantity, not create a second line the customer reconciles by hand.
   * `unitPricePoyshaAtAdd` is deliberately NOT refreshed on a repeat add — it records when
   * the customer first committed to the item.
   */
  async addItem(
    cartId: string,
    variantId: string,
    quantity: number,
    unitPricePoysha: bigint,
  ): Promise<CartItem | null> {
    try {
      return await this.prisma.cartItem.upsert({
        where: { cartId_variantId: { cartId, variantId } },
        create: {
          cart: { connect: { id: cartId } },
          variant: { connect: { id: variantId } },
          quantity,
          unitPricePoyshaAtAdd: unitPricePoysha,
        },
        update: { quantity: { increment: quantity } },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cartId, variantId },
        'Exception occurred in CartRepository.addItem',
      );
      return null;
    }
  }

  /** Scoped by cart as well as id, so one customer cannot edit another's line. */
  async updateItem(cartId: string, itemId: string, quantity: number): Promise<CartItemResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.cartItem.findFirst({ where: { id: itemId, cartId } });

        if (!target) {
          return undefined;
        }

        return await tx.cartItem.update({ where: { id: target.id }, data: { quantity } });
      });
    } catch (error) {
      this.logger.error(
        { err: error, cartId, itemId },
        'Exception occurred in CartRepository.updateItem',
      );
      return null;
    }
  }

  async removeItem(cartId: string, itemId: string): Promise<CartItemResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const target = await tx.cartItem.findFirst({ where: { id: itemId, cartId } });

        if (!target) {
          return undefined;
        }

        return await tx.cartItem.delete({ where: { id: target.id } });
      });
    } catch (error) {
      this.logger.error(
        { err: error, cartId, itemId },
        'Exception occurred in CartRepository.removeItem',
      );
      return null;
    }
  }

  async clear(cartId: string): Promise<boolean> {
    try {
      await this.prisma.cartItem.deleteMany({ where: { cartId } });
      return true;
    } catch (error) {
      this.logger.error({ err: error, cartId }, 'Exception occurred in CartRepository.clear');
      return false;
    }
  }

  async countLines(cartId: string): Promise<number | null> {
    try {
      return await this.prisma.cartItem.count({ where: { cartId } });
    } catch (error) {
      this.logger.error({ err: error, cartId }, 'Exception occurred in CartRepository.countLines');
      return null;
    }
  }

  /**
   * Sellable units per variant, summed across active warehouses.
   *
   * One query for every line on the basket rather than one per line — a basket is re-read on
   * every page view, so an N+1 here is felt on the busiest route in the shop.
   */
  async availableByVariant(variantIds: readonly string[]): Promise<Map<string, number> | null> {
    try {
      if (variantIds.length === 0) {
        return new Map();
      }

      const rows = await this.prisma.inventory.findMany({
        where: { variantId: { in: [...variantIds] }, warehouse: { isActive: true } },
        select: { variantId: true, quantityOnHand: true, quantityReserved: true },
      });

      const available = new Map<string, number>();

      rows.forEach((row) => {
        const current = available.get(row.variantId) ?? 0;
        available.set(row.variantId, current + row.quantityOnHand - row.quantityReserved);
      });

      return available;
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in CartRepository.availableByVariant');
      return null;
    }
  }

  async findCart(userId: string): Promise<Cart | null | undefined> {
    try {
      return (await this.prisma.cart.findUnique({ where: { userId } })) ?? undefined;
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Exception occurred in CartRepository.findCart');
      return null;
    }
  }
}
