import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { AdminCatalogRepository } from '../admin/admin-catalog.repository';
import { AuthService } from '../auth/auth.service';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/cart.dto';

const customer: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  role: UserRole.CUSTOMER,
};

const VARIANT = 'var-1';

const line = (overrides = {}) => ({
  id: 'line-1',
  variantId: VARIANT,
  quantity: 2,
  unitPricePoyshaAtAdd: 125000n,
  addedAt: new Date(),
  variant: {
    sku: 'ALM-500',
    nameEn: '500g',
    pricePoysha: 125000n,
    product: {
      slug: 'premium-almonds',
      nameEn: 'Premium Almonds',
      nameBn: 'প্রিমিয়াম কাঠবাদাম',
      isActive: true,
      publishedAt: new Date('2026-01-01'),
      images: [{ url: 'https://cdn.test/a.jpg' }],
    },
  },
  ...overrides,
});

const cart = (items: unknown[] = [line()]) => ({ id: 'cart-1', items });

const addDto = (overrides: Partial<AddCartItemDto> = {}): AddCartItemDto =>
  Object.assign(new AddCartItemDto(), { variantId: VARIANT, quantity: 1, ...overrides });

describe('CartService', () => {
  let repository: Record<string, jest.Mock>;
  let catalog: Record<string, jest.Mock>;
  let authService: { resolveActiveUserId: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: CartService;

  beforeEach(() => {
    repository = {
      findOrCreate: jest.fn().mockResolvedValue(cart()),
      findCart: jest.fn().mockResolvedValue({ id: 'cart-1' }),
      addItem: jest.fn().mockResolvedValue({ id: 'line-1' }),
      updateItem: jest.fn().mockResolvedValue({ id: 'line-1' }),
      removeItem: jest.fn().mockResolvedValue({ id: 'line-1' }),
      clear: jest.fn().mockResolvedValue(true),
      countLines: jest.fn().mockResolvedValue(1),
      availableByVariant: jest.fn().mockResolvedValue(new Map([[VARIANT, 50]])),
    };
    catalog = {
      findVariantById: jest
        .fn()
        .mockResolvedValue({ id: VARIANT, productId: 'p-1', isActive: true, pricePoysha: 125000n }),
      findProductById: jest
        .fn()
        .mockResolvedValue({ id: 'p-1', isActive: true, publishedAt: new Date('2026-01-01') }),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    service = new CartService(
      repository as unknown as CartRepository,
      catalog as unknown as AdminCatalogRepository,
      authService as unknown as AuthService,
      logger,
    );
  });

  describe('getCart', () => {
    it('values the basket at the LIVE price, not the added price', async () => {
      // Showing the added price as the total would let a customer reach checkout expecting
      // a figure the order will not honour.
      repository.findOrCreate.mockResolvedValue(
        cart([line({ unitPricePoyshaAtAdd: 100000n, quantity: 2 })]),
      );

      const result = await service.getCart(customer);

      expect(result.ok && result.data.items[0].lineTotalPoysha).toBe(250000);
      expect(result.ok && result.data.subtotalPoysha).toBe(250000);
    });

    it('flags a line whose price moved since it was added', async () => {
      repository.findOrCreate.mockResolvedValue(cart([line({ unitPricePoyshaAtAdd: 100000n })]));

      const result = await service.getCart(customer);

      expect(result.ok && result.data.items[0].priceChanged).toBe(true);
      expect(result.ok && result.data.items[0].unitPricePoyshaAtAdd).toBe(100000);
      expect(result.ok && result.data.hasPriceChanges).toBe(true);
    });

    it('does not flag a line whose price is unchanged', async () => {
      const result = await service.getCart(customer);

      expect(result.ok && result.data.items[0].priceChanged).toBe(false);
      expect(result.ok && result.data.hasPriceChanges).toBe(false);
    });

    it('flags a line asking for more than is in stock, on every read', async () => {
      repository.availableByVariant.mockResolvedValue(new Map([[VARIANT, 1]]));

      const result = await service.getCart(customer);

      expect(result.ok && result.data.items[0].exceedsStock).toBe(true);
      expect(result.ok && result.data.hasStockIssues).toBe(true);
    });

    it('treats a variant with no stock row as zero available', async () => {
      repository.availableByVariant.mockResolvedValue(new Map());

      const result = await service.getCart(customer);

      expect(result.ok && result.data.items[0].availableQuantity).toBe(0);
      expect(result.ok && result.data.items[0].exceedsStock).toBe(true);
    });

    it('returns an empty basket rather than a 404 for a new customer', async () => {
      repository.findOrCreate.mockResolvedValue(cart([]));

      const result = await service.getCart(customer);

      expect(result.ok && result.data).toEqual(
        expect.objectContaining({ items: [], subtotalPoysha: 0, itemCount: 0 }),
      );
    });

    it('counts units, not lines', async () => {
      repository.findOrCreate.mockResolvedValue(
        cart([line({ quantity: 2 }), line({ id: 'line-2', variantId: 'v2', quantity: 3 })]),
      );
      repository.availableByVariant.mockResolvedValue(
        new Map([
          [VARIANT, 50],
          ['v2', 50],
        ]),
      );

      const result = await service.getCart(customer);

      expect(result.ok && result.data.itemCount).toBe(5);
    });
  });

  describe('addItem', () => {
    it('adds a line at the live price', async () => {
      await service.addItem(customer, addDto());

      expect(repository.addItem).toHaveBeenCalledWith('cart-1', VARIANT, 1, 125000n);
    });

    it('refuses an inactive variant', async () => {
      catalog.findVariantById.mockResolvedValue({ id: VARIANT, productId: 'p-1', isActive: false });

      const result = await service.addItem(customer, addDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'That item is no longer available.',
      });
      expect(repository.addItem).not.toHaveBeenCalled();
    });

    it('refuses an unpublished product posted directly by variant id', async () => {
      // Otherwise the publish switch means nothing — a draft is reachable by anyone who
      // knows the id.
      catalog.findProductById.mockResolvedValue({ id: 'p-1', isActive: true, publishedAt: null });

      const result = await service.addItem(customer, addDto());

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
      expect(repository.addItem).not.toHaveBeenCalled();
    });

    it('refuses a product scheduled to publish in the future', async () => {
      catalog.findProductById.mockResolvedValue({
        id: 'p-1',
        isActive: true,
        publishedAt: new Date(Date.now() + 86_400_000),
      });

      const result = await service.addItem(customer, addDto());

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('refuses when nothing is in stock', async () => {
      repository.availableByVariant.mockResolvedValue(new Map([[VARIANT, 0]]));

      const result = await service.addItem(customer, addDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'That item is out of stock.',
      });
    });

    it('counts what is already in the basket when checking stock', async () => {
      // The line already holds 2; asking for 1 more against 2 available must fail.
      repository.availableByVariant.mockResolvedValue(new Map([[VARIANT, 2]]));

      const result = await service.addItem(customer, addDto({ quantity: 1 }));

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'Only 2 left in stock. Reduce the quantity or try again later.',
      });
    });

    it('allows adding up to exactly what is available', async () => {
      repository.findOrCreate.mockResolvedValue(cart([]));
      repository.availableByVariant.mockResolvedValue(new Map([[VARIANT, 3]]));

      const result = await service.addItem(customer, addDto({ quantity: 3 }));

      expect(result.ok).toBe(true);
    });

    it('refuses a new line once the basket is full', async () => {
      const full = Array.from({ length: 100 }, (_unused, index) =>
        line({ id: `l-${index}`, variantId: `v-${index}` }),
      );
      repository.findOrCreate.mockResolvedValue(cart(full));

      const result = await service.addItem(customer, addDto({ variantId: 'new-variant' }));

      expect(!result.ok && result.status).toBe(HttpStatus.CONFLICT);
    });

    it('still allows raising an existing line when the basket is full', async () => {
      const full = Array.from({ length: 100 }, (_unused, index) =>
        line({ id: `l-${index}`, variantId: index === 0 ? VARIANT : `v-${index}` }),
      );
      repository.findOrCreate.mockResolvedValue(cart(full));

      const result = await service.addItem(customer, addDto());

      expect(result.ok).toBe(true);
    });
  });

  describe('updateItem and removeItem', () => {
    it('sets an absolute quantity', async () => {
      await service.updateItem(customer, 'line-1', { quantity: 5 });

      expect(repository.updateItem).toHaveBeenCalledWith('cart-1', 'line-1', 5);
    });

    it("answers 404 for a line that is not in the caller's basket", async () => {
      repository.updateItem.mockResolvedValue(undefined);

      const result = await service.updateItem(customer, 'line-9', { quantity: 5 });

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('removes a line', async () => {
      await service.removeItem(customer, 'line-1');

      expect(repository.removeItem).toHaveBeenCalledWith('cart-1', 'line-1');
    });
  });

  describe('clear', () => {
    it('empties the basket', async () => {
      await service.clear(customer);

      expect(repository.clear).toHaveBeenCalledWith('cart-1');
    });

    it('is a no-op, not a 404, when no basket was ever created', async () => {
      repository.findCart.mockResolvedValue(undefined);

      const result = await service.clear(customer);

      expect(result.ok).toBe(true);
      expect(repository.clear).not.toHaveBeenCalled();
    });
  });

  it('passes a disabled account through without touching the basket', async () => {
    authService.resolveActiveUserId.mockResolvedValue({
      ok: false,
      status: HttpStatus.FORBIDDEN,
      message: 'This account has been disabled. Please contact support.',
    });

    const result = await service.getCart(customer);

    expect(!result.ok && result.status).toBe(HttpStatus.FORBIDDEN);
    expect(repository.findOrCreate).not.toHaveBeenCalled();
  });
});
