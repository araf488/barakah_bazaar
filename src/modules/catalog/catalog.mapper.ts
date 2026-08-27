import { Category } from '../../infra/prisma/prisma-client';
import { Money } from '../../common/money/money';
import {
  CategoryResponseDto,
  ProductDetailDto,
  ProductHandlingDto,
  ProductImageDto,
  ProductListItemDto,
  ProductVariantDto,
} from './dto/catalog-response.dto';
import { ProductWithRelations } from './catalog.repository';

/**
 * Prisma rows to API DTOs.
 *
 * This is where BigInt poysha becomes a JSON-safe number: every price stays an
 * integer in the payload, and the formatted string is added alongside it so no
 * client has to guess the currency layout.
 */
export const CatalogMapper = {
  /** Assembles the flat category rows into a tree, preserving sort order. */
  toCategoryTree(categories: readonly Category[]): CategoryResponseDto[] {
    const nodes = new Map<string, CategoryResponseDto>(
      categories.map((category) => [category.id, CatalogMapper.toCategoryNode(category)]),
    );

    const roots: CategoryResponseDto[] = [];

    categories.forEach((category) => {
      const node = nodes.get(category.id);
      if (!node) {
        return;
      }
      // A child whose parent is inactive (and so absent) is promoted to a root
      // rather than dropped — hiding a whole subtree over one flag is worse.
      const parent = category.parentId ? nodes.get(category.parentId) : undefined;
      (parent ? parent.children : roots).push(node);
    });

    return roots;
  },

  toProductListItem(product: ProductWithRelations): ProductListItemDto {
    const fromPrice = CatalogMapper.cheapestVariantPrice(product);
    const primary = product.images.at(0);

    return {
      id: product.id,
      slug: product.slug,
      nameEn: product.nameEn,
      nameBn: product.nameBn,
      brand: product.brand,
      pricingMode: product.pricingMode,
      fromPricePoysha: Money.toJsonNumber(fromPrice),
      fromPriceFormatted: Money.format(fromPrice),
      primaryImage: primary ? CatalogMapper.toImageDto(primary) : null,
      handling: CatalogMapper.toHandlingDto(product),
    };
  },

  toProductDetail(product: ProductWithRelations): ProductDetailDto {
    return {
      ...CatalogMapper.toProductListItem(product),
      descriptionEn: product.descriptionEn,
      descriptionBn: product.descriptionBn,
      categorySlug: product.category.slug,
      variants: product.variants.map((variant) => CatalogMapper.toVariantDto(variant)),
      images: product.images.map((image) => CatalogMapper.toImageDto(image)),
    };
  },

  toVariantDto(variant: ProductWithRelations['variants'][number]): ProductVariantDto {
    return {
      id: variant.id,
      sku: variant.sku,
      nameEn: variant.nameEn,
      nameBn: variant.nameBn,
      pricePoysha: Money.toJsonNumber(variant.pricePoysha),
      compareAtPricePoysha:
        variant.compareAtPricePoysha === null
          ? null
          : Money.toJsonNumber(variant.compareAtPricePoysha),
      priceFormatted: Money.format(variant.pricePoysha),
      weightGrams: variant.weightGrams,
      unitLabel: variant.unitLabel,
      isDefault: variant.isDefault,
    };
  },

  toImageDto(image: ProductWithRelations['images'][number]): ProductImageDto {
    return { url: image.url, altText: image.altText, isPrimary: image.isPrimary };
  },

  toHandlingDto(product: ProductWithRelations): ProductHandlingDto {
    return {
      isPerishable: product.isPerishable,
      storageType: product.storageType,
      shelfLifeHours: product.shelfLifeHours,
      maxDeliveryDistanceKm: product.maxDeliveryDistanceKm,
    };
  },

  toCategoryNode(category: Category): CategoryResponseDto {
    return {
      id: category.id,
      slug: category.slug,
      nameEn: category.nameEn,
      nameBn: category.nameBn,
      imageUrl: category.imageUrl,
      sortOrder: category.sortOrder,
      children: [],
    };
  },

  /**
   * "From" price for a listing. Variants arrive cheapest-first from the
   * repository; a product with no active variant shows zero rather than
   * breaking the grid.
   */
  cheapestVariantPrice(product: ProductWithRelations): bigint {
    const prices = product.variants.map((variant) => variant.pricePoysha);
    if (prices.length === 0) {
      return 0n;
    }
    return prices.reduce((low, price) => (price < low ? price : low), prices[0]);
  },
} as const;
