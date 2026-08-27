import { Category, PricingMode, StorageType } from '../../src/infra/prisma/prisma-client';
import { ProductWithRelations } from '../../src/modules/catalog/catalog.repository';

/** A category row, defaulting to an active root node. */
export const categoryFixture = (overrides: Partial<Category> = {}): Category => ({
  id: 'cat-dry-fruits',
  slug: 'dry-fruits',
  nameEn: 'Dry Fruits',
  nameBn: 'শুকনো ফল',
  parentId: null,
  imageUrl: null,
  sortOrder: 0,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

type VariantOverrides = Partial<ProductWithRelations['variants'][number]>;

export const variantFixture = (
  overrides: VariantOverrides = {},
): ProductWithRelations['variants'][number] => ({
  id: 'var-500g',
  productId: 'prod-almonds',
  sku: 'ALM-500',
  nameEn: '500g pack',
  nameBn: '৫০০ গ্রাম প্যাক',
  pricePoysha: 95000n,
  compareAtPricePoysha: null,
  weightGrams: 500,
  unitLabel: '500g',
  isDefault: true,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

type ImageOverrides = Partial<ProductWithRelations['images'][number]>;

export const imageFixture = (
  overrides: ImageOverrides = {},
): ProductWithRelations['images'][number] => ({
  id: 'img-1',
  productId: 'prod-almonds',
  url: 'https://project.supabase.co/storage/v1/object/public/product-images/almonds.jpg',
  altText: 'Almonds',
  sortOrder: 0,
  isPrimary: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

/** A published, non-perishable product with one variant and one image. */
export const productFixture = (
  overrides: Partial<ProductWithRelations> = {},
): ProductWithRelations => ({
  id: 'prod-almonds',
  slug: 'premium-almonds',
  nameEn: 'Premium Almonds',
  nameBn: 'প্রিমিয়াম কাঠবাদাম',
  descriptionEn: 'Hand-picked California almonds.',
  descriptionBn: null,
  categoryId: 'cat-dry-fruits',
  brand: 'Barakah Select',
  pricingMode: PricingMode.WEIGHT,
  isPerishable: false,
  shelfLifeHours: null,
  storageType: StorageType.AMBIENT,
  maxDeliveryDistanceKm: null,
  isActive: true,
  publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  category: { slug: 'dry-fruits' },
  variants: [variantFixture()],
  images: [imageFixture()],
  ...overrides,
});
