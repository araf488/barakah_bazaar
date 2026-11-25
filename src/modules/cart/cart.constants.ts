/** Cart-module constants. Cross-cutting values live in app.constants.ts. */
export const CartConstants = {
  RouteBase: 'cart',
  CartItemResourceName: 'Cart item',
  /** Distinct lines one basket may hold. */
  MaxLines: 100,
  /** Units of one variant in a single line. Beyond this it is a wholesale order. */
  MaxQuantityPerLine: 99,
} as const;

export const CartMessages = {
  /** The variant is gone, deactivated, or its product is not published. */
  ItemUnavailable: 'That item is no longer available.',
  /** {0} = the cap. */
  TooManyLinesTemplate:
    'A basket can hold at most {0} different items. Remove something before adding more.',
  /** {0} = units available. */
  InsufficientStockTemplate: 'Only {0} left in stock. Reduce the quantity or try again later.',
  /** Nothing in stock at all. */
  OutOfStock: 'That item is out of stock.',
  /** Returned when checkout is attempted on an empty basket. */
  CartEmpty: 'Your basket is empty.',
} as const;
