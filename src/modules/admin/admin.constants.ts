/** Admin-module constants. Cross-cutting values live in app.constants.ts. */
export const AdminConstants = {
  /** Route segment this module is mounted on, under the global API prefix. */
  RouteBase: 'admin',
  /** Resource label used in not-found messages. */
  AuditEntryResourceName: 'Audit entry',
  /** Audit reads are heavy; cap a page lower than the app-wide maximum. */
  MaxAuditPageSize: 50,
  UserResourceName: 'User',
  MaxUserSearchLength: 120,
  ImageResourceName: 'Product image',
  MaxImagesPerProduct: 10,
  MaxAltTextLength: 200,
  /** Formats a storefront can render everywhere. HEIC and TIFF cannot be. */
  AllowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
  CategoryResourceName: 'Category',
  ProductResourceName: 'Product',
  VariantResourceName: 'Product variant',
  MaxNameLength: 200,
  MaxSlugLength: 140,
  MaxDescriptionLength: 5000,
  MaxSkuLength: 64,
  MaxUnitLabelLength: 40,
  MaxBrandLength: 120,
  /** Rows one import may carry. Bounded so the whole import fits in one transaction. */
  MaxImportRows: 500,
  MaxImportBytes: 1_000_000,
  /** Lowercase letters, digits and single hyphens. The storefront routes on this. */
  SlugPattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
} as const;

/**
 * Every auditable action, as a dotted `entity.verb`.
 *
 * A closed set rather than free-text strings: the audit log is queried by action, and a
 * typo'd verb makes a write invisible to the search that would have found it.
 */
export const AdminAuditActions = {
  CategoryCreated: 'category.created',
  CategoryUpdated: 'category.updated',
  CategoryDeactivated: 'category.deactivated',
  ProductCreated: 'product.created',
  ProductsImported: 'product.imported',
  ProductUpdated: 'product.updated',
  ProductPublished: 'product.published',
  ProductUnpublished: 'product.unpublished',
  ProductDeactivated: 'product.deactivated',
  VariantCreated: 'variant.created',
  VariantUpdated: 'variant.updated',
  VariantDeactivated: 'variant.deactivated',
  ImageAdded: 'product_image.added',
  ImageUpdated: 'product_image.updated',
  ImageRemoved: 'product_image.removed',
  CustomerDisabled: 'customer.disabled',
  CustomerEnabled: 'customer.enabled',
  StaffRoleChanged: 'staff.role_changed',
  StaffRoleChangePartial: 'staff.role_change_partial',
} as const;

export type AdminAuditAction = (typeof AdminAuditActions)[keyof typeof AdminAuditActions];

/** Entity labels used in `entityType`. Kept together so no service invents its own. */
export const AdminAuditEntities = {
  Category: 'Category',
  Product: 'Product',
  ProductVariant: 'ProductVariant',
  ProductImage: 'ProductImage',
  User: 'User',
} as const;

export const AdminMessages = {
  /** Refusing an action a staff member aimed at their own account. */
  CannotActOnSelf:
    'You cannot change your own account here. Ask another super admin to make this change.',
  /** Refusing to remove the last super admin. */
  LastSuperAdmin:
    'This is the only super admin. Promote someone else before changing this account.',
  /** Supabase rejected the role write, so nothing was changed. */
  RoleChangeRejected:
    'The role could not be updated in the identity provider. Nothing was changed.',
  /** Supabase accepted the role but the local record failed — needs an operator. */
  RoleChangePartial:
    'The role was changed in the identity provider but could not be recorded locally. Contact an administrator before making further changes.',
  /** {0} = the cap. */
  ImageLimitReachedTemplate:
    'A product may have at most {0} images. Remove one before adding another.',
  /** A URL that did not come from our own storage bucket. */
  ImageUrlNotOurs:
    "Image URLs must point at this project's product-images storage bucket. Request an upload URL first.",
  /** {0} = the type sent, {1} = the allowed list. */
  ImageTypeUnsupportedTemplate: '{0} is not a supported image type. Use one of: {1}.',
  /** Storage is not configured, so no upload URL can be minted. */
  StorageUnavailable: 'Image uploads are not available right now.',
  /** The file had no usable rows. */
  ImportEmpty: 'The file contains no product rows.',
  /** {0} = the row cap. */
  ImportTooLargeTemplate:
    'An import may contain at most {0} rows. Split the file and upload it in parts.',
  /** Nothing was written because at least one row was rejected. */
  ImportRejected:
    'Nothing was imported. Every row must be valid — fix the rows listed below and upload again.',
  /** {0} = the slug already taken. */
  SlugTakenTemplate: 'The slug "{0}" is already in use. Slugs must be unique.',
  /** {0} = the SKU already taken. */
  SkuTakenTemplate: 'The SKU "{0}" is already in use.',
  /** A parent category that does not exist, or is itself inactive. */
  ParentCategoryUnavailable: 'The parent category does not exist or is inactive.',
  /** A category cannot be its own ancestor. */
  CategoryCycle: 'A category cannot be moved beneath itself or one of its own descendants.',
  /** Refusing to deactivate a category that still holds live products. */
  CategoryInUse:
    'This category still has active products or subcategories. Move or deactivate them first.',
  /** The product's category must exist and be active. */
  CategoryUnavailable: 'The selected category does not exist or is inactive.',
  /** Publishing needs something to sell. */
  PublishNeedsVariant:
    'A product needs at least one active variant with a price before it can be published.',
  /** WEIGHT pricing is meaningless without a net weight. */
  WeightRequired:
    'This product is priced by weight, so every variant must specify its weight in grams.',
  /** compareAtPrice is the "was" price and must be higher than what is charged. */
  CompareAtPriceTooLow: 'The compare-at price must be higher than the selling price.',
  /** Returned when an audit write fails during an operation that requires one. */
  AuditTrailUnavailable:
    'The change could not be recorded in the audit trail and was not applied. Please try again.',
} as const;
