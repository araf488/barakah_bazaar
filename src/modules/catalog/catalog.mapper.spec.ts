import {
  categoryFixture,
  imageFixture,
  productFixture,
  variantFixture,
} from '../../../test/support/catalog-fixtures';
import { StorageType } from '../../infra/prisma/prisma-client';
import { CatalogMapper } from './catalog.mapper';

describe('CatalogMapper', () => {
  describe('toCategoryTree', () => {
    it('returns an empty tree for no categories', () => {
      expect(CatalogMapper.toCategoryTree([])).toEqual([]);
    });

    it('keeps a flat list of roots flat', () => {
      const tree = CatalogMapper.toCategoryTree([
        categoryFixture({ id: 'a', slug: 'a' }),
        categoryFixture({ id: 'b', slug: 'b' }),
      ]);

      expect(tree).toHaveLength(2);
      expect(tree.every((node) => node.children.length === 0)).toBe(true);
    });

    it('nests a child under its parent', () => {
      const tree = CatalogMapper.toCategoryTree([
        categoryFixture({ id: 'beauty', slug: 'health-beauty' }),
        categoryFixture({ id: 'baby', slug: 'baby', parentId: 'beauty' }),
      ]);

      expect(tree).toHaveLength(1);
      expect(tree[0].children.map((child) => child.slug)).toEqual(['baby']);
    });

    it('nests three levels deep', () => {
      const tree = CatalogMapper.toCategoryTree([
        categoryFixture({ id: 'beauty', slug: 'health-beauty' }),
        categoryFixture({ id: 'baby', slug: 'baby', parentId: 'beauty' }),
        categoryFixture({ id: 'skin', slug: 'baby-skin-care', parentId: 'baby' }),
      ]);

      expect(tree[0].children[0].children[0].slug).toBe('baby-skin-care');
    });

    it('preserves the order the rows arrived in', () => {
      const tree = CatalogMapper.toCategoryTree([
        categoryFixture({ id: 'a', slug: 'first', sortOrder: 0 }),
        categoryFixture({ id: 'b', slug: 'second', sortOrder: 1 }),
      ]);

      expect(tree.map((node) => node.slug)).toEqual(['first', 'second']);
    });

    it('promotes an orphan to a root rather than dropping its subtree', () => {
      const tree = CatalogMapper.toCategoryTree([
        categoryFixture({ id: 'baby', slug: 'baby', parentId: 'inactive-parent' }),
      ]);

      expect(tree.map((node) => node.slug)).toEqual(['baby']);
    });

    it('maps the display fields of a node', () => {
      const [node] = CatalogMapper.toCategoryTree([categoryFixture()]);

      expect(node).toEqual({
        id: 'cat-dry-fruits',
        slug: 'dry-fruits',
        nameEn: 'Dry Fruits',
        nameBn: 'শুকনো ফল',
        imageUrl: null,
        sortOrder: 0,
        children: [],
      });
    });
  });

  describe('toProductListItem', () => {
    it('exposes the cheapest variant price as an integer number of poysha', () => {
      const product = productFixture({
        variants: [
          variantFixture({ id: 'v1', pricePoysha: 95000n }),
          variantFixture({ id: 'v2', pricePoysha: 49500n }),
        ],
      });

      const item = CatalogMapper.toProductListItem(product);

      expect(item.fromPricePoysha).toBe(49500);
      expect(Number.isInteger(item.fromPricePoysha)).toBe(true);
    });

    it('formats the from-price for display', () => {
      const item = CatalogMapper.toProductListItem(productFixture());

      expect(item.fromPriceFormatted).toContain('950.00');
    });

    it('falls back to zero when no variant is active', () => {
      const item = CatalogMapper.toProductListItem(productFixture({ variants: [] }));

      expect(item.fromPricePoysha).toBe(0);
    });

    it('uses the first image as the primary image', () => {
      const product = productFixture({
        images: [
          imageFixture({ id: 'primary', url: 'https://cdn/primary.jpg', isPrimary: true }),
          imageFixture({ id: 'secondary', url: 'https://cdn/secondary.jpg', isPrimary: false }),
        ],
      });

      expect(CatalogMapper.toProductListItem(product).primaryImage?.url).toBe(
        'https://cdn/primary.jpg',
      );
    });

    it('reports a null primary image when the product has none', () => {
      expect(
        CatalogMapper.toProductListItem(productFixture({ images: [] })).primaryImage,
      ).toBeNull();
    });

    it('carries the perishable handling facts the storefront needs', () => {
      const product = productFixture({
        isPerishable: true,
        storageType: StorageType.CHILLED,
        shelfLifeHours: 48,
        maxDeliveryDistanceKm: 12,
      });

      expect(CatalogMapper.toProductListItem(product).handling).toEqual({
        isPerishable: true,
        storageType: StorageType.CHILLED,
        shelfLifeHours: 48,
        maxDeliveryDistanceKm: 12,
      });
    });
  });

  describe('toProductDetail', () => {
    it('includes the category slug and descriptions', () => {
      const detail = CatalogMapper.toProductDetail(productFixture());

      expect(detail.categorySlug).toBe('dry-fruits');
      expect(detail.descriptionEn).toBe('Hand-picked California almonds.');
    });

    it('maps every variant', () => {
      const detail = CatalogMapper.toProductDetail(
        productFixture({
          variants: [
            variantFixture({ id: 'v1', sku: 'ALM-250' }),
            variantFixture({ id: 'v2', sku: 'ALM-500' }),
          ],
        }),
      );

      expect(detail.variants.map((variant) => variant.sku)).toEqual(['ALM-250', 'ALM-500']);
    });

    it('converts every variant price to an integer, never a float', () => {
      const detail = CatalogMapper.toProductDetail(
        productFixture({ variants: [variantFixture({ pricePoysha: 123456789n })] }),
      );

      expect(detail.variants[0].pricePoysha).toBe(123456789);
    });

    it('maps a null compare-at price to null rather than zero', () => {
      const detail = CatalogMapper.toProductDetail(
        productFixture({ variants: [variantFixture({ compareAtPricePoysha: null })] }),
      );

      expect(detail.variants[0].compareAtPricePoysha).toBeNull();
    });

    it('maps a present compare-at price', () => {
      const detail = CatalogMapper.toProductDetail(
        productFixture({ variants: [variantFixture({ compareAtPricePoysha: 110000n })] }),
      );

      expect(detail.variants[0].compareAtPricePoysha).toBe(110000);
    });

    it('produces a JSON-serializable payload with no BigInt left in it', () => {
      const detail = CatalogMapper.toProductDetail(productFixture());

      expect(() => JSON.stringify(detail)).not.toThrow();
    });
  });

  describe('cheapestVariantPrice', () => {
    it('returns the lowest price regardless of arrival order', () => {
      const product = productFixture({
        variants: [
          variantFixture({ id: 'a', pricePoysha: 30000n }),
          variantFixture({ id: 'b', pricePoysha: 10000n }),
          variantFixture({ id: 'c', pricePoysha: 20000n }),
        ],
      });

      expect(CatalogMapper.cheapestVariantPrice(product)).toBe(10000n);
    });

    it('returns zero when there are no variants', () => {
      expect(CatalogMapper.cheapestVariantPrice(productFixture({ variants: [] }))).toBe(0n);
    });
  });
});
