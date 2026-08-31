import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { OrderStatus, PaymentMethod, UserRole } from '../../infra/prisma/prisma-client';
import { createMockLogger } from '../../../test/support/mocks';
import { addressFixture } from '../../../test/support/user-fixtures';
import { AuthService } from '../auth/auth.service';
import { CartRepository } from '../cart/cart.repository';
import { InventoryRepository } from '../inventory/inventory.repository';
import { AddressRepository } from '../user/address.repository';
import { OrderQueryDto, PlaceOrderDto } from './dto/order.dto';
import { DeliveryService } from '../delivery/delivery.service';
import { NotificationService } from '../notification/notification.service';
import { CheckoutSources } from './checkout-sources';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

const customer: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  role: UserRole.CUSTOMER,
};

const staff: AuthenticatedUser = { supabaseUserId: 'sub-2', role: UserRole.OPS };

const cartLine = (overrides = {}) => ({
  variantId: 'var-1',
  quantity: 2,
  unitPricePoyshaAtAdd: 125000n,
  variant: {
    sku: 'ALM-500',
    nameEn: '500g',
    pricePoysha: 125000n,
    product: { nameEn: 'Almonds', nameBn: 'কাঠবাদাম' },
  },
  ...overrides,
});

const cart = (items: unknown[] = [cartLine()]) => ({ id: 'cart-1', items });

const order = (overrides = {}) => ({
  id: 'ord-1',
  userId: 'user-1',
  orderNumber: 'BB-20260830-000001',
  status: OrderStatus.PLACED,
  paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
  paymentStatus: 'PENDING',
  warehouseId: 'wh-1',
  recipientName: 'Rahim',
  phone: '+8801712345678',
  division: 'Dhaka',
  district: 'Dhaka',
  upazila: 'Savar',
  area: null,
  addressLine: 'House 12',
  postCode: null,
  subtotalPoysha: 250000n,
  deliveryFeePoysha: 0n,
  discountPoysha: 0n,
  totalPoysha: 250000n,
  customerNote: null,
  placedAt: new Date(),
  deliveredAt: null,
  items: [],
  events: [],
  ...overrides,
});

const placeDto = (overrides: Partial<PlaceOrderDto> = {}): PlaceOrderDto =>
  Object.assign(new PlaceOrderDto(), { addressId: 'address-1', ...overrides });

describe('OrderService', () => {
  let repository: Record<string, jest.Mock>;
  let cartRepository: Record<string, jest.Mock>;
  let addressRepository: Record<string, jest.Mock>;
  let inventoryRepository: Record<string, jest.Mock>;
  let authService: { resolveActiveUserId: jest.Mock };
  let notifications: { notifyOrderStatus: jest.Mock };
  let delivery: { resolveFee: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: OrderService;

  beforeEach(() => {
    repository = {
      place: jest.fn().mockResolvedValue(order()),
      findById: jest.fn().mockResolvedValue(order()),
      findForUser: jest.fn().mockResolvedValue(order()),
      findPage: jest.fn().mockResolvedValue({ items: [order()], total: 1 }),
      transition: jest.fn().mockResolvedValue(order({ status: OrderStatus.CONFIRMED })),
    };
    cartRepository = { findOrCreate: jest.fn().mockResolvedValue(cart()) };
    addressRepository = { findOneForUser: jest.fn().mockResolvedValue(addressFixture()) };
    inventoryRepository = {
      listWarehouses: jest.fn().mockResolvedValue([{ id: 'wh-1' }]),
      findStock: jest.fn().mockResolvedValue({ quantityOnHand: 50, quantityReserved: 0 }),
    };
    authService = {
      resolveActiveUserId: jest.fn().mockResolvedValue({ ok: true, data: 'user-1' }),
    };
    logger = createMockLogger();
    notifications = { notifyOrderStatus: jest.fn().mockResolvedValue(undefined) };
    delivery = {
      resolveFee: jest.fn().mockResolvedValue({
        ok: true,
        data: { feePoysha: 6000n, zone: { nameEn: 'Inside Dhaka' }, isFree: false },
      }),
    };

    service = new OrderService(
      repository as unknown as OrderRepository,
      new CheckoutSources(
        cartRepository as unknown as CartRepository,
        addressRepository as unknown as AddressRepository,
        inventoryRepository as unknown as InventoryRepository,
      ),
      authService as unknown as AuthService,
      notifications as unknown as NotificationService,
      delivery as unknown as DeliveryService,
      logger,
    );
  });

  describe('placeOrder', () => {
    it('places an order and freezes the line price', async () => {
      const result = await service.placeOrder(customer, placeDto());

      expect(result.ok).toBe(true);
      const data = repository.place.mock.calls[0][0] as {
        items: { unitPricePoysha: bigint; lineTotalPoysha: bigint }[];
        totalPoysha: bigint;
      };
      expect(data.items[0].unitPricePoysha).toBe(125000n);
      expect(data.items[0].lineTotalPoysha).toBe(250000n);
      // Subtotal plus the resolved delivery fee.
      expect(data.totalPoysha).toBe(256000n);
    });

    it('snapshots the address as text rather than referencing it', async () => {
      // The customer may edit or delete the address later; the order must always say where
      // it was actually sent.
      await service.placeOrder(customer, placeDto());

      const data = repository.place.mock.calls[0][0] as { address: { addressLine: string } };
      expect(data.address.addressLine).toBe('House 12, Road 4');
    });

    it('re-proves the address belongs to the caller', async () => {
      await service.placeOrder(customer, placeDto());

      expect(addressRepository.findOneForUser).toHaveBeenCalledWith('user-1', 'address-1');
    });

    it("answers 404 for another customer's address id", async () => {
      addressRepository.findOneForUser.mockResolvedValue(undefined);

      const result = await service.placeOrder(customer, placeDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'That delivery address is no longer available.',
      });
      expect(repository.place).not.toHaveBeenCalled();
    });

    it('refuses an empty basket', async () => {
      cartRepository.findOrCreate.mockResolvedValue(cart([]));

      const result = await service.placeOrder(customer, placeDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'Your basket is empty.',
      });
    });

    it('refuses when a price moved and the customer has not confirmed', async () => {
      // Charging the new price silently is the complaint; this is what the stored
      // added-price exists to prevent.
      cartRepository.findOrCreate.mockResolvedValue(
        cart([cartLine({ unitPricePoyshaAtAdd: 100000n })]),
      );

      const result = await service.placeOrder(customer, placeDto());

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message:
          'Some prices have changed since you added these items. Review your basket and try again.',
      });
      expect(repository.place).not.toHaveBeenCalled();
    });

    it('places it once the customer accepts the price change', async () => {
      cartRepository.findOrCreate.mockResolvedValue(
        cart([cartLine({ unitPricePoyshaAtAdd: 100000n })]),
      );

      const result = await service.placeOrder(customer, placeDto({ acceptPriceChanges: true }));

      expect(result.ok).toBe(true);
      // Charged at the LIVE price, not the one it was added at, plus delivery.
      const data = repository.place.mock.calls[0][0] as { totalPoysha: bigint };
      expect(data.totalPoysha).toBe(256000n);
    });

    it('picks a hub that can cover the whole basket', async () => {
      inventoryRepository.listWarehouses.mockResolvedValue([{ id: 'wh-short' }, { id: 'wh-1' }]);
      inventoryRepository.findStock.mockImplementation((warehouseId: string) =>
        Promise.resolve(
          warehouseId === 'wh-short'
            ? { quantityOnHand: 1, quantityReserved: 0 }
            : { quantityOnHand: 50, quantityReserved: 0 },
        ),
      );

      await service.placeOrder(customer, placeDto());

      expect((repository.place.mock.calls[0][0] as { warehouseId: string }).warehouseId).toBe(
        'wh-1',
      );
    });

    it('refuses rather than splitting an order no single hub can fill', async () => {
      inventoryRepository.findStock.mockResolvedValue({ quantityOnHand: 1, quantityReserved: 0 });

      const result = await service.placeOrder(customer, placeDto());

      expect(!result.ok && result.message).toBe('We cannot deliver to that address right now.');
    });

    it('counts reserved stock as unavailable when choosing a hub', async () => {
      inventoryRepository.findStock.mockResolvedValue({ quantityOnHand: 2, quantityReserved: 1 });

      const result = await service.placeOrder(customer, placeDto());

      expect(!result.ok).toBe(true);
    });

    it('defaults to cash on delivery', async () => {
      await service.placeOrder(customer, placeDto());

      expect((repository.place.mock.calls[0][0] as { paymentMethod: string }).paymentMethod).toBe(
        PaymentMethod.CASH_ON_DELIVERY,
      );
    });
  });

  describe('transitions', () => {
    it.each([
      [OrderStatus.PLACED, OrderStatus.CONFIRMED],
      [OrderStatus.CONFIRMED, OrderStatus.PICKING],
      [OrderStatus.PICKING, OrderStatus.DISPATCHED],
      [OrderStatus.DISPATCHED, OrderStatus.DELIVERED],
    ])('allows %s → %s', async (from, to) => {
      repository.findById.mockResolvedValue(order({ status: from }));

      const result = await service.transitionOrder(staff, 'ord-1', { status: to });

      expect(result.ok).toBe(true);
      expect(repository.transition).toHaveBeenCalledWith('ord-1', from, to, 'user-1', null);
    });

    it('refuses a jump that skips dispatch', async () => {
      // Skipping DISPATCHED means stock never leaves the shelf and nothing downstream notices.
      const result = await service.transitionOrder(staff, 'ord-1', {
        status: OrderStatus.DELIVERED,
      });

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'An order cannot go from PLACED to DELIVERED.',
      });
      expect(repository.transition).not.toHaveBeenCalled();
    });

    it('refuses cancelling an order already with a rider', async () => {
      repository.findById.mockResolvedValue(order({ status: OrderStatus.DISPATCHED }));

      const result = await service.transitionOrder(staff, 'ord-1', {
        status: OrderStatus.CANCELLED,
      });

      expect(!result.ok && result.status).toBe(HttpStatus.CONFLICT);
    });

    it.each([OrderStatus.CANCELLED, OrderStatus.REFUNDED])(
      'treats %s as terminal',
      async (terminal) => {
        repository.findById.mockResolvedValue(order({ status: terminal }));

        const result = await service.transitionOrder(staff, 'ord-1', {
          status: OrderStatus.CONFIRMED,
        });

        expect(!result.ok && result.status).toBe(HttpStatus.CONFLICT);
      },
    );

    it('records the staff member who moved it', async () => {
      await service.transitionOrder(staff, 'ord-1', {
        status: OrderStatus.CONFIRMED,
        note: 'Stock checked',
      });

      expect(repository.transition).toHaveBeenCalledWith(
        'ord-1',
        OrderStatus.PLACED,
        OrderStatus.CONFIRMED,
        'user-1',
        'Stock checked',
      );
    });
  });

  describe('delivery pricing', () => {
    it('resolves the fee from the destination and the live subtotal', async () => {
      await service.placeOrder(customer, placeDto());

      expect(delivery.resolveFee).toHaveBeenCalledWith(
        { division: 'Dhaka', district: 'Dhaka', unit: 'Savar' },
        250000n,
      );
    });

    it('charges the fee the service resolved, never one from the request', async () => {
      delivery.resolveFee.mockResolvedValue({
        ok: true,
        data: { feePoysha: 12000n, zone: { nameEn: 'Outside Dhaka' }, isFree: false },
      });

      await service.placeOrder(customer, placeDto());

      const data = repository.place.mock.calls[0][0] as {
        deliveryFeePoysha: bigint;
        subtotalPoysha: bigint;
        totalPoysha: bigint;
      };

      expect(data.deliveryFeePoysha).toBe(12000n);
      expect(data.subtotalPoysha).toBe(250000n);
      expect(data.totalPoysha).toBe(262000n);
    });

    it('charges nothing when the basket earned free delivery', async () => {
      delivery.resolveFee.mockResolvedValue({
        ok: true,
        data: { feePoysha: 0n, zone: { nameEn: 'Inside Dhaka' }, isFree: true },
      });

      await service.placeOrder(customer, placeDto());

      const data = repository.place.mock.calls[0][0] as { totalPoysha: bigint };

      expect(data.totalPoysha).toBe(250000n);
    });

    it('refuses the order rather than shipping free when pricing is unconfigured', async () => {
      // A silent zero here is a revenue leak nobody notices. Refusing is loud and gets fixed.
      delivery.resolveFee.mockResolvedValue({
        ok: false,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'Delivery is not available to that address yet. Please contact support.',
      });

      const result = await service.placeOrder(customer, placeDto());

      expect(result.ok).toBe(false);
      expect(repository.place).not.toHaveBeenCalled();
    });
  });

  describe('notifying the customer', () => {
    it('announces a placed order, from the phone snapshotted onto it', async () => {
      await service.placeOrder(customer, placeDto());

      expect(notifications.notifyOrderStatus).toHaveBeenCalledWith(OrderStatus.PLACED, {
        userId: 'user-1',
        phone: '+8801712345678',
        orderId: 'ord-1',
        orderNumber: 'BB-20260830-000001',
        recipientName: 'Rahim',
        totalPoysha: 250000n,
      });
    });

    it('announces the status the order actually reached, not the one requested', async () => {
      repository.findById.mockResolvedValue(order({ status: OrderStatus.PICKING }));
      repository.transition.mockResolvedValue(order({ status: OrderStatus.DISPATCHED }));

      await service.transitionOrder(staff, 'ord-1', { status: OrderStatus.DISPATCHED });

      expect(notifications.notifyOrderStatus).toHaveBeenCalledWith(
        OrderStatus.DISPATCHED,
        expect.objectContaining({ orderId: 'ord-1' }),
      );
    });

    it('still places the order when the notification throws', async () => {
      // The whole point of the seam: the sale is committed, and a dead SMS gateway is not
      // allowed to turn a successful checkout into an error the customer sees.
      notifications.notifyOrderStatus.mockRejectedValue(new Error('gateway exploded'));

      const result = await service.placeOrder(customer, placeDto());

      expect(result.ok).toBe(true);
      expect(logger.error).toHaveBeenCalled();
    });

    it('still reports a transition that succeeded when the notification throws', async () => {
      notifications.notifyOrderStatus.mockRejectedValue(new Error('gateway exploded'));
      repository.findById.mockResolvedValue(order({ status: OrderStatus.PICKING }));
      repository.transition.mockResolvedValue(order({ status: OrderStatus.DISPATCHED }));

      const result = await service.transitionOrder(staff, 'ord-1', {
        status: OrderStatus.DISPATCHED,
      });

      expect(result.ok).toBe(true);
    });

    it('says nothing when the order was refused', async () => {
      repository.place.mockResolvedValue(null);

      await service.placeOrder(customer, placeDto());

      expect(notifications.notifyOrderStatus).not.toHaveBeenCalled();
    });

    it('says nothing when a transition was refused as illegal', async () => {
      await service.transitionOrder(staff, 'ord-1', { status: OrderStatus.DELIVERED });

      expect(notifications.notifyOrderStatus).not.toHaveBeenCalled();
    });
  });

  describe('cancelMyOrder', () => {
    it('lets a customer cancel before dispatch', async () => {
      const result = await service.cancelMyOrder(customer, 'ord-1', {});

      expect(result.ok).toBe(true);
      // Null actor: the customer cancelled it, not a staff member.
      expect(repository.transition).toHaveBeenCalledWith(
        'ord-1',
        OrderStatus.PLACED,
        OrderStatus.CANCELLED,
        null,
        null,
      );
    });

    it.each([OrderStatus.PICKING, OrderStatus.DISPATCHED, OrderStatus.DELIVERED])(
      'refuses a customer cancelling once it is %s',
      async (status) => {
        repository.findForUser.mockResolvedValue(order({ status }));

        const result = await service.cancelMyOrder(customer, 'ord-1', {});

        expect(!result.ok && result.message).toBe(
          'This order has already been dispatched and can no longer be cancelled. Contact support.',
        );
      },
    );

    it("answers 404 for another customer's order", async () => {
      repository.findForUser.mockResolvedValue(undefined);

      const result = await service.cancelMyOrder(customer, 'ord-9', {});

      expect(!result.ok && result.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('listMyOrders', () => {
    it('scopes the query to the caller', async () => {
      await service.listMyOrders(customer, new OrderQueryDto());

      expect((repository.findPage.mock.calls[0][0] as { userId: string }).userId).toBe('user-1');
    });

    it('reports canCancel from the status', async () => {
      const result = await service.listMyOrders(customer, new OrderQueryDto());

      expect(result.ok && result.data.items[0].canCancel).toBe(true);
    });
  });
});
