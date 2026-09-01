/** Inventory-module constants. Cross-cutting values live in app.constants.ts. */
export const InventoryConstants = {
  RouteBase: 'admin/inventory',
  WarehouseResourceName: 'Warehouse',
  StockResourceName: 'Stock line',
  VariantResourceName: 'Product variant',
  MaxWarehouseCodeLength: 20,
  MaxNoteLength: 500,
  MaxBatchCodeLength: 60,
  /** A single receipt or adjustment above this is almost certainly a typo. */
  MaxMovementQuantity: 1_000_000,
  /** How far ahead "expiring soon" looks by default. */
  DefaultExpiryHorizonDays: 7,
} as const;

export const InventoryAuditActions = {
  WarehouseCreated: 'warehouse.created',
  WarehouseUpdated: 'warehouse.updated',
  WarehouseDeactivated: 'warehouse.deactivated',
  StockReceived: 'stock.received',
  StockAdjusted: 'stock.adjusted',
} as const;

export const InventoryMessages = {
  /** {0} = warehouse code. */
  WarehouseCodeTakenTemplate: 'A warehouse with the code "{0}" already exists.',
  /** The variant must exist and be sellable before stock can be booked against it. */
  VariantUnavailable: 'That product variant does not exist or is inactive.',
  /** Refusing an adjustment that would drive stock below zero. */
  InsufficientStockTemplate:
    'Only {0} units are on hand. An adjustment cannot take stock below zero.',
  /** Refusing to remove stock that is promised to a checkout. */
  ReservedStockTemplate:
    '{0} of the {1} units on hand are reserved for checkouts in progress and cannot be removed.',
  /** A receipt must say when the goods expire, for anything perishable. */
  ExpiryRequired: 'This product is perishable, so a receipt must include the batch expiry date.',
  /** An expiry already in the past cannot be received as sellable stock. */
  ExpiryInPast: 'The expiry date has already passed. Receive it as a write-off instead.',
  /**
   * The typed expiry is further out than the product's whole shelf life allows.
   *
   * A plausibility check, not a calculation: shelf life runs from production, and stock always
   * arrives partway through it, so the true expiry is always sooner than received + shelf
   * life. Anything LATER than that ceiling is a typo — a year mistyped, or the wrong box.
   */
  ExpiryBeyondShelfLifeTemplate:
    'That expiry is more than {0} hours away, which is longer than this product keeps. Check the date on the batch.',
  /** The hub cannot hold this product's storage condition. */
  StorageNotSupportedTemplate: 'This hub cannot store {0} items. Receive them into a hub that can.',
  /** Refusing to deactivate a warehouse that still holds stock. */
  WarehouseHoldsStock:
    'This warehouse still holds stock. Transfer or write it off before deactivating.',
  /** No stock line exists yet for this warehouse and variant. */
  NoStockLine: 'No stock has ever been received for this variant at this warehouse.',
} as const;
