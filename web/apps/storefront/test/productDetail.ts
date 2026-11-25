import type { ProductDetail, ProductVariant } from '../lib/api/catalog';
import { product } from './fixtures';

export const variant = (overrides: Partial<ProductVariant> = {}): ProductVariant => ({
  id: 'v-500',
  sku: 'AJWA-500',
  nameEn: 'Ajwa Dates 500g',
  nameBn: 'আজওয়া খেজুর ৫০০ গ্রাম',
  pricePoysha: 125000,
  compareAtPricePoysha: null,
  priceFormatted: '৳1,250.00',
  weightGrams: 500,
  unitLabel: '500g',
  isDefault: true,
  ...overrides,
});

export const productDetail = (overrides: Partial<ProductDetail> = {}): ProductDetail => ({
  ...product(),
  descriptionEn: 'Soft Ajwa dates from Madinah.\n\nStore in a cool, dry place.',
  descriptionBn: 'মদিনার নরম আজওয়া খেজুর।',
  categorySlug: 'dates',
  variants: [
    variant({
      id: 'v-250',
      sku: 'AJWA-250',
      nameEn: 'Ajwa Dates 250g',
      nameBn: 'আজওয়া খেজুর ২৫০ গ্রাম',
      unitLabel: '250g',
      pricePoysha: 65000,
      priceFormatted: '৳650.00',
      weightGrams: 250,
      isDefault: false,
    }),
    variant(),
  ],
  images: [
    { url: 'https://cdn.example.test/ajwa-2.jpg', altText: null, isPrimary: false },
    {
      url: 'https://cdn.example.test/ajwa-1.jpg',
      altText: 'A bowl of Ajwa dates',
      isPrimary: true,
    },
  ],
  ...overrides,
});
