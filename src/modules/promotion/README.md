# Promotion module

**Status:** implemented — promo codes at checkout.

Discounts a customer can claim by code.

## Owned tables

- `promotions`
- `promotion_redemptions`

## Why this exists

`orders.discount_poysha` was on the order and **nothing ever wrote it** — read in the DTO and
the mapper, always zero. This is the third column of that shape, after `payment_status` and
`delivery_fee_poysha`.

## The redemption ledger IS the usage limit

There is deliberately **no `times_used` counter** on a promotion. A counter is the classic way
to oversell a coupon: two concurrent checkouts read the same value, both find room, and both
write the same increment. Limits are counted from `promotion_redemptions`, which is the only
count that cannot drift from what was actually granted.

The redemption row is written **inside the order transaction**, so a redemption without an
order — or an order that claimed a discount without recording it — cannot exist. A unique index
on `order_id` means a retried checkout cannot count twice.

## Three types, and why FREE_DELIVERY is its own

| Type            | Reduces               | Notes                                                      |
| --------------- | --------------------- | ---------------------------------------------------------- |
| `PERCENTAGE`    | the goods             | whole percent 1–100, optional cap, clamped to the subtotal |
| `FIXED_AMOUNT`  | the goods             | clamped to the subtotal                                    |
| `FREE_DELIVERY` | the delivery fee only | never the goods                                            |

`FREE_DELIVERY` is not "100% off delivery" expressed as a percentage. It has to reduce the fee
_specifically_, and a percentage that happened to equal the fee would start discounting the
basket the moment either number moved.

Every branch is capped against its own base, and checkout floors the total at zero. **A promo
code can never turn an order into money owed to the customer.**

Percentage arithmetic truncates, which rounds by at most one poysha in the customer's
disfavour. Deliberate: rounding the other way lets a percentage exceed its own cap.

## Order of operations at checkout

Delivery fee first, **then** the discount — because `FREE_DELIVERY` needs a fee to waive. A test
asserts the call order so a refactor cannot quietly swap them.

## A bad code fails the checkout

It is not ignored. Silently dropping an invalid code charges the customer full price for an
order they believed was discounted, and they find out on the receipt.

## What the customer can see

The preview endpoint says what _this_ basket saves and nothing else — no limits, no remaining
uses, no window. It is authenticated because the per-customer limit is part of the answer: an
anonymous preview could not say whether this customer has already used the code.

An unknown code, an inactive one and one outside its window all answer identically, so the
endpoint cannot be used to enumerate the catalogue.

## Guarantees the database enforces

| Guarantee                 | How                                                          |
| ------------------------- | ------------------------------------------------------------ |
| One case per code         | `CHECK (code = upper(code))` + unique index                  |
| A percentage is 1–100     | `CHECK (type <> 'PERCENTAGE' OR value BETWEEN 1 AND 100)`    |
| A cap only on percentages | `CHECK (max_discount_poysha IS NULL OR type = 'PERCENTAGE')` |
| A window that can be used | `CHECK (ends_at IS NULL OR ends_at > starts_at)`             |
| One redemption per order  | unique index on `order_id`                                   |
| No worthless redemption   | `CHECK (discount_poysha > 0)`                                |

## RLS

No policy on either table. `promotions` because a readable table hands every customer the whole
code list, including unlaunched campaigns. `promotion_redemptions` because the row count _is_
the limit — a client that could insert could exhaust a rival's allowance, and one that could
delete could redeem a single-use code forever.

## Admin

`SUPER_ADMIN` and `MARKETING` — campaigns are marketing's job, and this is the first surface
that role owns. Every write goes through the shared audit trail in one transaction, and a
failed audit row refuses the change.

## Not built

- Product- or category-scoped promotions. Every code today applies to the whole basket.
- Automatic promotions with no code.
- Stacking. One promotion per order, enforced by the unique index.
