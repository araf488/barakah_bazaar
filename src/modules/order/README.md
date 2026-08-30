# Order module

**Status:** implemented — Phase 1

Checkout, the order state machine, and the sweep that returns stock nobody claimed.

## Owned tables

- `orders`
- `order_items`
- `order_events` — append-only transition history

Stock holds live in `stock_reservations`, owned by the inventory module. This module creates
and settles them but never redefines them.

## Design notes

- **State machine.** `ORDER_TRANSITIONS` in `order.constants.ts` is the only definition of
  what may follow what: `PLACED → CONFIRMED → PICKING → DISPATCHED → DELIVERED`, with
  `CANCELLED` and `REFUNDED` as terminal branches. Transitions are validated, not assigned.
- **Checkout is one transaction.** The order, its lines, the stock holds, the mirrored
  `quantity_reserved` counters, the `RESERVED` movements, the opening event and the cart
  clear all commit together or not at all.
- **Prices and addresses are snapshotted** onto the order at placement. A later catalog edit
  or a deleted address cannot rewrite what the customer agreed to.
- **Stock settles inside the transition**, never alongside it: `DISPATCHED` commits the held
  units, `CANCELLED` and `REFUNDED` give them back — the latter only when the order had not
  already dispatched, since those units are gone.

## How long stock stays held

The hold window depends on what the order is waiting for, which is not the same for every
payment method:

| Payment method                          | Hold       | Because                                                                                 |
| --------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `CASH_ON_DELIVERY`                      | 168 hours  | There is no payment step. The order waits on staff to confirm it, which can take a day. |
| `BKASH` (and any future prepaid method) | 30 minutes | The customer is sitting at a payment screen.                                            |

Applying the prepaid window to COD would release stock for perfectly good orders after half
an hour and then sell those units twice. The COD window is a backstop against an order nobody
ever actions, not a payment timeout.

## The reservation sweep

`ReservationSweeper` runs every five minutes on a plain interval and cancels orders whose
hold has outlived its window while the order is still `PLACED` or `CONFIRMED`. Without it, an
abandoned checkout holds its units for good — a hold is only released on cancel or dispatch,
so an order reaching neither silently removes stock from sale.

Three decisions worth keeping:

1. **It cancels the order rather than releasing the hold directly.** Cancellation already
   returns the stock, writes the movement and records the event. A second path that touched
   inventory would be a second place for stock and orders to drift apart.
2. **It only touches `PLACED` and `CONFIRMED`.** Once an order is `PICKING` or beyond, staff
   are working it and the hold is doing its job however long it has been.
3. **It uses `setInterval`, not BullMQ or a scheduler package.** The queue is optional and
   disabled by default, and returning abandoned stock has to work on a bare deployment with
   no Redis. Two instances sweeping at once is harmless: the transition refuses an order that
   has already moved, so the loser finds nothing to do.

A read failure returns `null` and the sweep does nothing — a failed query is not evidence
that a hold is dead.

## Conventions this module follows

The rules that apply to every module are in the repository README under **Conventions**; the
ones this module would get wrong if skipped:

1. Every public method on the controller, service and repository wraps its body in
   `try`/`catch` and logs with the error object first.
2. Services return `ServiceResponse<T>`; only the controller turns that into an HTTP status,
   via `unwrapOrThrow`.
3. Money is integer poysha (`BigInt`), converted to a number only in the mapper.
4. Unit tests for every layer this module touches.
5. RLS is enabled on every table here, in `prisma/rls/` — `orders` and `order_items` are
   owner-scoped for SELECT; `order_events` has no policy at all, so only the service role
   reaches it.
