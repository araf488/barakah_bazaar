import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { Money } from '../../common/money/money';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { OrderStatus, PaymentMethod, Prisma } from '../../infra/prisma/prisma-client';
import { AuthService } from '../auth/auth.service';
import { CartWithItems } from '../cart/cart.repository';
import {
  AdminOrderQueryDto,
  CancelOrderDto,
  OrderDto,
  OrderQueryDto,
  PlaceOrderDto,
  TransitionOrderDto,
} from './dto/order.dto';
import {
  CUSTOMER_CANCELLABLE,
  ORDER_TRANSITIONS,
  OrderConstants,
  OrderMessages,
} from './order.constants';
import { DeliveryService } from '../delivery/delivery.service';
import { NotificationService } from '../notification/notification.service';
import { CheckoutSources } from './checkout-sources';
import { OrderRepository, OrderWithDetail, PlaceOrderData } from './order.repository';

/**
 * Placing and moving orders.
 *
 * Checkout is the moment every earlier "we'll check this later" comes due: the basket is
 * re-priced, stock is re-checked, the address is re-proved to belong to the caller, and only
 * then is the whole thing written in one transaction that also holds the stock and empties
 * the basket.
 *
 * Status changes are a state machine rather than a settable column. An order that jumps from
 * PLACED to DELIVERED skipped the dispatch that decrements stock, and nothing downstream
 * would notice until a count came up short.
 */
@Injectable()
export class OrderService {
  constructor(
    private readonly repository: OrderRepository,
    private readonly sources: CheckoutSources,
    private readonly authService: AuthService,
    private readonly notifications: NotificationService,
    private readonly delivery: DeliveryService,
    @InjectPinoLogger(OrderService.name) private readonly logger: PinoLogger,
  ) {}

  async placeOrder(
    user: AuthenticatedUser,
    dto: PlaceOrderDto,
  ): Promise<ServiceResponse<OrderDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const cart = await this.sources.carts.findOrCreate(owner.data);
      if (cart === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (cart.items.length === 0) {
        return serviceFail(HttpStatus.CONFLICT, OrderMessages.CartEmpty);
      }

      // The address is re-proved to be the caller's here, not trusted from the request: the
      // id is the only thing a client controls, and it names somebody's home.
      const address = await this.sources.addresses.findOneForUser(owner.data, dto.addressId);

      if (address === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (address === undefined) {
        return serviceFail(HttpStatus.NOT_FOUND, OrderMessages.AddressUnavailable);
      }

      const priced = OrderService.assertPricesAccepted(cart, dto.acceptPriceChanges === true);
      if (!priced.ok) {
        return priced;
      }

      const warehouse = await this.resolveWarehouse(cart);
      if (!warehouse.ok) {
        return warehouse;
      }

      // Resolved server-side, never taken from the request: a delivery charge the customer
      // can choose is a delivery charge the customer will choose to be zero.
      const delivery = await this.delivery.resolveFee(
        { division: address.division, district: address.district, unit: address.upazila },
        OrderService.subtotalOf(cart),
      );

      if (!delivery.ok) {
        return delivery;
      }

      const order = await this.repository.place(
        OrderService.toPlaceData(
          owner.data,
          cart,
          address,
          warehouse.data,
          dto,
          delivery.data.feePoysha,
        ),
      );

      if (order === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      // Outside the transaction, and deliberately not awaited for its result: the order is
      // already committed, and a gateway that is slow or down must not hold the customer at
      // the checkout screen or undo a sale.
      await this.announce(order);

      return serviceOk(OrderService.toDto(order, true));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in OrderService.placeOrder');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async listMyOrders(
    user: AuthenticatedUser,
    query: OrderQueryDto,
  ): Promise<ServiceResponse<PaginatedResponseDto<OrderDto>>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const where: Prisma.OrderWhereInput = {
        userId: owner.data,
        ...(query.status ? { status: query.status } : {}),
      };

      return await this.page(where, query);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in OrderService.listMyOrders');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async getMyOrder(user: AuthenticatedUser, id: string): Promise<ServiceResponse<OrderDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const order = await this.repository.findForUser(owner.data, id);

      return OrderService.single(order, true);
    } catch (error) {
      this.logger.error(
        { err: error, orderId: id },
        'Exception occurred in OrderService.getMyOrder',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** A customer cancelling their own order. Allowed only before it leaves the hub. */
  async cancelMyOrder(
    user: AuthenticatedUser,
    id: string,
    dto: CancelOrderDto,
  ): Promise<ServiceResponse<OrderDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const order = await this.repository.findForUser(owner.data, id);

      if (!order) {
        return OrderService.single(order, true);
      }

      if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
        return serviceFail(HttpStatus.CONFLICT, OrderMessages.TooLateToCancel);
      }

      return await this.move(order, OrderStatus.CANCELLED, null, dto.reason ?? null);
    } catch (error) {
      this.logger.error(
        { err: error, orderId: id },
        'Exception occurred in OrderService.cancelMyOrder',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async listAllOrders(
    query: AdminOrderQueryDto,
  ): Promise<ServiceResponse<PaginatedResponseDto<OrderDto>>> {
    try {
      const where: Prisma.OrderWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      };

      return await this.page(where, query);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in OrderService.listAllOrders');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Staff moving an order along, with the transition checked against the state machine. */
  async transitionOrder(
    user: AuthenticatedUser,
    id: string,
    dto: TransitionOrderDto,
  ): Promise<ServiceResponse<OrderDto>> {
    try {
      const actor = await this.authService.resolveActiveUserId(user);
      if (!actor.ok) {
        return actor;
      }

      const order = await this.repository.findById(id);

      if (!order) {
        return OrderService.single(order, false);
      }

      return await this.move(order, dto.status, actor.data, dto.note ?? null);
    } catch (error) {
      this.logger.error(
        { err: error, orderId: id },
        'Exception occurred in OrderService.transitionOrder',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async move(
    order: OrderWithDetail,
    to: OrderStatus,
    actorId: string | null,
    note: string | null,
  ): Promise<ServiceResponse<OrderDto>> {
    if (!ORDER_TRANSITIONS[order.status].includes(to)) {
      return serviceFail(
        HttpStatus.CONFLICT,
        formatMessage(OrderMessages.IllegalTransitionTemplate, order.status, to),
      );
    }

    const moved = await this.repository.transition(order.id, order.status, to, actorId, note);

    if (moved === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    await this.announce(moved);

    return serviceOk(OrderService.toDto(moved, true));
  }

  /**
   * Tells the customer where their order got to.
   *
   * Never throws and never reports failure upward: the status change has already committed,
   * and an order that moved but could not be announced is a message to retry, not a
   * transition to undo. NotificationService records the attempt and its sweep retries it.
   */
  private async announce(order: OrderWithDetail): Promise<void> {
    try {
      await this.notifyStatus(order);
    } catch (error) {
      // The catch that makes the guarantee real. NotificationService already swallows its own
      // failures, but this method is called from inside placeOrder's try block: without this,
      // anything thrown here would be caught there and turned into a 500 for an order that
      // has already committed and taken the customer's stock.
      this.logger.error(
        { err: error, orderId: order.id, status: order.status },
        'Order committed but could not be announced',
      );
    }
  }

  private async notifyStatus(order: OrderWithDetail): Promise<void> {
    await this.notifications.notifyOrderStatus(order.status, {
      userId: order.userId,
      // The phone snapshotted onto the order, not the account's: the customer chose who
      // receives this delivery, and that is who should hear about it.
      phone: order.phone,
      orderId: order.id,
      orderNumber: order.orderNumber,
      recipientName: order.recipientName,
      totalPoysha: order.totalPoysha,
    });
  }

  private async page(
    where: Prisma.OrderWhereInput,
    query: OrderQueryDto,
  ): Promise<ServiceResponse<PaginatedResponseDto<OrderDto>>> {
    const page = await this.repository.findPage(where, query.skip, query.limit);

    if (page === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    return serviceOk(
      PaginatedResponseDto.of(
        page.items.map((order) => OrderService.toDto(order, false)),
        page.total,
        query.page,
        query.limit,
      ),
    );
  }

  /**
   * Refuses a basket whose prices moved unless the customer said they had seen the change.
   *
   * This is what the stored added-price is for. Charging the new price silently is the
   * complaint; refusing outright is the frustration. Confirming is neither.
   */
  private static assertPricesAccepted(
    cart: CartWithItems,
    accepted: boolean,
  ): ServiceResponse<void> {
    if (accepted) {
      return serviceOk<void>(undefined);
    }

    const changed = cart.items.some(
      (item) => item.variant.pricePoysha !== item.unitPricePoyshaAtAdd,
    );

    if (changed) {
      return serviceFail(HttpStatus.CONFLICT, OrderMessages.PricesChanged);
    }

    return serviceOk<void>(undefined);
  }

  /**
   * Picks the hub that can fulfil the WHOLE basket.
   *
   * Splitting an order across hubs means two deliveries and two pick lists, which the
   * delivery module does not model yet — so a basket no single hub can satisfy is refused
   * rather than half-shipped.
   */
  private async resolveWarehouse(cart: CartWithItems): Promise<ServiceResponse<string>> {
    const warehouses = await this.sources.inventory.listWarehouses(false);

    if (warehouses === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    for (const warehouse of warehouses) {
      const shortfall = await this.findShortfall(warehouse.id, cart);

      if (shortfall === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (shortfall === undefined) {
        return serviceOk(warehouse.id);
      }
    }

    return serviceFail(HttpStatus.CONFLICT, OrderMessages.NoWarehouse);
  }

  /** The first line this hub cannot cover, or undefined when it can cover them all. */
  private async findShortfall(
    warehouseId: string,
    cart: CartWithItems,
  ): Promise<string | null | undefined> {
    for (const item of cart.items) {
      const stock = await this.sources.inventory.findStock(warehouseId, item.variantId);

      if (stock === null) {
        return null;
      }

      const available = stock ? stock.quantityOnHand - stock.quantityReserved : 0;

      if (available < item.quantity) {
        return item.variantId;
      }
    }

    return undefined;
  }

  /** The basket's value at live prices. One definition, used for the fee and for the order. */
  private static subtotalOf(cart: CartWithItems): bigint {
    return cart.items.reduce(
      (total, item) => total + item.variant.pricePoysha * BigInt(item.quantity),
      0n,
    );
  }

  private static toPlaceData(
    userId: string,
    cart: CartWithItems,
    address: {
      recipientName: string;
      phone: string;
      division: string;
      district: string;
      upazila: string;
      area: string | null;
      addressLine: string;
      postCode: string | null;
      latitude: number | null;
      longitude: number | null;
    },
    warehouseId: string,
    dto: PlaceOrderDto,
    deliveryFee: bigint,
  ): PlaceOrderData {
    const items = cart.items.map((item) => ({
      variantId: item.variantId,
      sku: item.variant.sku,
      productNameEn: item.variant.product.nameEn,
      productNameBn: item.variant.product.nameBn,
      variantNameEn: item.variant.nameEn,
      quantity: item.quantity,
      unitPricePoysha: item.variant.pricePoysha,
      lineTotalPoysha: item.variant.pricePoysha * BigInt(item.quantity),
    }));

    const subtotal = items.reduce((total, item) => total + item.lineTotalPoysha, 0n);

    return {
      userId,
      warehouseId,
      paymentMethod: dto.paymentMethod ?? PaymentMethod.CASH_ON_DELIVERY,
      address: {
        recipientName: address.recipientName,
        phone: address.phone,
        division: address.division,
        district: address.district,
        upazila: address.upazila,
        area: address.area,
        addressLine: address.addressLine,
        postCode: address.postCode,
        latitude: address.latitude,
        longitude: address.longitude,
      },
      customerNote: dto.customerNote ?? null,
      subtotalPoysha: subtotal,
      deliveryFeePoysha: deliveryFee,
      totalPoysha: subtotal + deliveryFee,
      items,
      cartId: cart.id,
    };
  }

  private static single(
    order: OrderWithDetail | null | undefined,
    withEvents: boolean,
  ): ServiceResponse<OrderDto> {
    if (order === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (order === undefined) {
      return serviceFail(
        HttpStatus.NOT_FOUND,
        formatMessage(ErrorMessageTemplates.NotFound, OrderConstants.OrderResourceName),
      );
    }

    return serviceOk(OrderService.toDto(order, withEvents));
  }

  private static toDto(order: OrderWithDetail, withEvents: boolean): OrderDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      recipientName: order.recipientName,
      phone: order.phone,
      division: order.division,
      district: order.district,
      unit: order.upazila,
      area: order.area,
      addressLine: order.addressLine,
      postCode: order.postCode,
      subtotalPoysha: Money.toJsonNumber(order.subtotalPoysha),
      deliveryFeePoysha: Money.toJsonNumber(order.deliveryFeePoysha),
      discountPoysha: Money.toJsonNumber(order.discountPoysha),
      totalPoysha: Money.toJsonNumber(order.totalPoysha),
      totalFormatted: Money.format(order.totalPoysha),
      customerNote: order.customerNote,
      placedAt: order.placedAt,
      deliveredAt: order.deliveredAt,
      items: order.items.map((item) => ({
        id: item.id,
        sku: item.sku,
        productNameEn: item.productNameEn,
        productNameBn: item.productNameBn,
        variantNameEn: item.variantNameEn,
        quantity: item.quantity,
        unitPricePoysha: Money.toJsonNumber(item.unitPricePoysha),
        lineTotalPoysha: Money.toJsonNumber(item.lineTotalPoysha),
        lineTotalFormatted: Money.format(item.lineTotalPoysha),
      })),
      ...(withEvents
        ? {
            events: order.events.map((event) => ({
              fromStatus: event.fromStatus,
              toStatus: event.toStatus,
              note: event.note,
              createdAt: event.createdAt,
            })),
          }
        : {}),
      canCancel: CUSTOMER_CANCELLABLE.includes(order.status),
    };
  }
}
