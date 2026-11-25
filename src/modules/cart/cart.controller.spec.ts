import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';

const customer: AuthenticatedUser = {
  userId: '11111111-1111-1111-1111-111111111111',
  sessionId: 'session-1',
  email: 'test@example.com',
  role: UserRole.CUSTOMER,
};

const emptyCart = {
  items: [],
  subtotalPoysha: 0,
  subtotalFormatted: '৳0.00',
  itemCount: 0,
  hasPriceChanges: false,
  hasStockIssues: false,
};

describe('CartController', () => {
  let cartService: Record<string, jest.Mock>;
  let controller: CartController;

  beforeEach(() => {
    cartService = {
      getCart: jest.fn().mockResolvedValue({ ok: true, data: emptyCart }),
      addItem: jest.fn().mockResolvedValue({ ok: true, data: emptyCart }),
      updateItem: jest.fn().mockResolvedValue({ ok: true, data: emptyCart }),
      removeItem: jest.fn().mockResolvedValue({ ok: true, data: emptyCart }),
      clear: jest.fn().mockResolvedValue({ ok: true, data: emptyCart }),
    };
    controller = new CartController(cartService as unknown as CartService, createMockLogger());
  });

  describe('routing', () => {
    it('returns the basket', async () => {
      await expect(controller.getCart(customer)).resolves.toEqual(emptyCart);
    });

    it.each([
      ['getCart', () => controller.getCart(undefined)],
      ['clear', () => controller.clear(undefined)],
    ])('refuses %s with no verified caller', async (_label, call) => {
      await expect(call()).rejects.toThrow(UnauthorizedException);
    });

    it('returns the WHOLE basket after a mutation, not just the line', async () => {
      // The storefront needs the recalculated subtotal, price flags and stock warnings
      // after any change; returning them together removes a round trip.
      const dto = Object.assign(new AddCartItemDto(), { variantId: 'v1', quantity: 1 });

      await expect(controller.addItem(customer, dto)).resolves.toEqual(emptyCart);
    });

    it('surfaces the out-of-stock conflict', async () => {
      cartService.addItem.mockResolvedValue({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'That item is out of stock.',
      });

      await expect(
        controller.addItem(
          customer,
          Object.assign(new AddCartItemDto(), { variantId: 'v1', quantity: 1 }),
        ),
      ).rejects.toThrow('That item is out of stock.');
    });

    it('surfaces an unavailable item as 404', async () => {
      cartService.addItem.mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'That item is no longer available.',
      });

      await expect(
        controller.addItem(
          customer,
          Object.assign(new AddCartItemDto(), { variantId: 'v1', quantity: 1 }),
        ),
      ).rejects.toThrow(HttpException);
    });

    it('passes the line id through on update and remove', async () => {
      await controller.updateItem(customer, 'line-1', { quantity: 4 });
      await controller.removeItem(customer, 'line-1');

      expect(cartService.updateItem).toHaveBeenCalledWith(customer, 'line-1', { quantity: 4 });
      expect(cartService.removeItem).toHaveBeenCalledWith(customer, 'line-1');
    });
  });

  describe('AddCartItemDto validation', () => {
    it('accepts a valid payload', async () => {
      await expect(
        validate(plainToInstance(AddCartItemDto, { variantId: 'v1', quantity: 2 })),
      ).resolves.toEqual([]);
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['fractional', 1.5],
    ])('rejects a %s quantity', async (_label, quantity) => {
      const errors = await validate(plainToInstance(AddCartItemDto, { variantId: 'v1', quantity }));

      expect(errors).not.toEqual([]);
    });

    it('rejects a wholesale quantity — that is not a basket', async () => {
      const errors = await validate(
        plainToInstance(AddCartItemDto, { variantId: 'v1', quantity: 500 }),
      );

      expect(errors).not.toEqual([]);
    });

    it('requires a variant', async () => {
      const errors = await validate(plainToInstance(AddCartItemDto, { quantity: 1 }));

      expect(errors.map((error) => error.property)).toContain('variantId');
    });
  });

  describe('UpdateCartItemDto validation', () => {
    it('accepts an absolute quantity', async () => {
      await expect(validate(plainToInstance(UpdateCartItemDto, { quantity: 3 }))).resolves.toEqual(
        [],
      );
    });

    it('rejects zero — removing a line is DELETE, not a quantity of nothing', async () => {
      const errors = await validate(plainToInstance(UpdateCartItemDto, { quantity: 0 }));

      expect(errors).not.toEqual([]);
    });
  });
});
