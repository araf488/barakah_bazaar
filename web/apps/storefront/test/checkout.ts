import type { DeliveryQuote, Order, SlotOccurrence } from '../lib/checkout/api';

export const slot = (overrides: Partial<SlotOccurrence> = {}): SlotOccurrence => ({
  slotId: 'slot-morning',
  date: '2026-11-20',
  startMinute: 600,
  endMinute: 720,
  remaining: 10,
  supportsPerishable: true,
  ...overrides,
});

export const quote = (overrides: Partial<DeliveryQuote> = {}): DeliveryQuote => ({
  feePoysha: 6000,
  zoneNameEn: 'Dhaka city',
  zoneNameBn: 'ঢাকা শহর',
  isFree: false,
  freeDeliveryShortfallPoysha: 0,
  ...overrides,
});

export const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'order-1',
  orderNumber: 'BB-20261119-0001',
  status: 'PLACED',
  paymentMethod: 'CASH_ON_DELIVERY',
  paymentStatus: 'PENDING',
  recipientName: 'Tahmina Rahman',
  phone: '+8801712345678',
  division: 'Dhaka',
  district: 'Dhaka',
  unit: 'Gulshan',
  area: 'Banani',
  addressLine: 'House 12, Road 4',
  postCode: '1213',
  subtotalPoysha: 250000,
  deliveryFeePoysha: 6000,
  discountPoysha: 0,
  totalPoysha: 256000,
  customerNote: null,
  placedAt: '2026-11-19T10:00:00Z',
  items: [
    {
      id: 'oi-1',
      sku: 'AJWA-500',
      productNameEn: 'Ajwa Dates',
      productNameBn: 'আজওয়া খেজুর',
      variantNameEn: '500g',
      quantity: 2,
      unitPricePoysha: 125000,
      lineTotalPoysha: 250000,
    },
  ],
  canCancel: true,
  ...overrides,
});
