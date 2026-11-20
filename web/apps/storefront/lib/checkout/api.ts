import { type CallerContext, callApi, callApiExplained } from '../auth/api';

// Server-side client for checkout: delivery quote (src/modules/delivery), promo preview
// (src/modules/promotion), delivery slots and orders (src/modules/order).

/** One bookable delivery window on one date (`GET /orders/delivery-slots`). */
export interface SlotOccurrence {
  slotId: string;
  /** yyyy-mm-dd, Dhaka time. */
  date: string;
  /** Minutes from midnight. */
  startMinute: number;
  endMinute: number;
  remaining: number;
  supportsPerishable: boolean;
}

/** `POST /delivery/quote`: the fee for one address and basket value. */
export interface DeliveryQuote {
  feePoysha: number;
  zoneNameEn: string;
  zoneNameBn: string | null;
  isFree: boolean;
  /** How much more the basket needs for free delivery; 0 when already free or never free. */
  freeDeliveryShortfallPoysha: number;
}

/** `POST /promotions/preview`: what a code would take off. */
export interface PromotionPreview {
  code: string;
  nameEn: string;
  nameBn: string | null;
  discountPoysha: number;
}

export type PaymentMethod = 'CASH_ON_DELIVERY' | 'BKASH';

/** Where an order is (prisma `OrderStatus`); the API moves it, the storefront only reads it. */
export type OrderStatus =
  'PLACED' | 'CONFIRMED' | 'PICKING' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED';

export type PaymentStatus = 'PENDING' | 'PAID' | 'REFUNDED' | 'FAILED';

/** One status change in an order's history (detail view only). */
export interface OrderEvent {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  sku: string;
  productNameEn: string;
  productNameBn: string;
  variantNameEn: string;
  quantity: number;
  unitPricePoysha: number;
  lineTotalPoysha: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  unit: string;
  area: string | null;
  addressLine: string;
  postCode: string | null;
  subtotalPoysha: number;
  deliveryFeePoysha: number;
  discountPoysha: number;
  totalPoysha: number;
  customerNote: string | null;
  placedAt: string;
  deliveredAt: string | null;
  items: OrderItem[];
  /** Present on `GET /orders/:id`, absent from the list. */
  events?: OrderEvent[];
  /** True while the shopper may still cancel it themselves (placed or confirmed). */
  canCancel: boolean;
}

export interface PlaceOrderInput {
  addressId: string;
  paymentMethod: PaymentMethod;
  deliverySlotId?: string;
  deliveryDate?: string;
  promotionCode?: string;
  customerNote?: string;
  acceptPriceChanges?: boolean;
}

/** The place a quote is for: the address's geo names, as the address book stores them. */
export interface QuotePlace {
  division: string;
  district: string;
  unit: string;
}

/** Days of delivery windows the checkout offers. */
export const SLOT_DAYS = 7;

const ORDERS_PATH = '/orders';

export const checkoutApi = {
  slots: (caller: CallerContext, addressId: string) =>
    callApiExplained<SlotOccurrence[]>(
      'GET',
      `${ORDERS_PATH}/delivery-slots?${new URLSearchParams({ addressId, days: String(SLOT_DAYS) })}`,
      caller,
    ),
  quote: (caller: CallerContext, place: QuotePlace, subtotalPoysha: number) =>
    callApiExplained<DeliveryQuote>('POST', '/delivery/quote', caller, {
      ...place,
      subtotalPoysha,
    }),
  previewPromotion: (
    caller: CallerContext,
    code: string,
    subtotalPoysha: number,
    deliveryFeePoysha: number,
  ) =>
    callApiExplained<PromotionPreview>('POST', '/promotions/preview', caller, {
      code,
      subtotalPoysha,
      deliveryFeePoysha,
    }),
  place: (caller: CallerContext, input: PlaceOrderInput) =>
    callApiExplained<Order>('POST', ORDERS_PATH, caller, input),
  order: (caller: CallerContext, id: string) =>
    callApi<Order>('GET', `${ORDERS_PATH}/${encodeURIComponent(id)}`, caller),
};
