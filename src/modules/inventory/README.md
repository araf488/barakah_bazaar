# Inventory module

**Status:** stock, receipts, adjustments and the ledger are live. Reservations are taken at checkout by the order module and released by its sweep (Phase 1)

Stock per hub, batch and expiry tracking, low-stock and expiring-batch alerts.

## Owned tables

- `warehouses` ✅ — one row per hub, dark store or shop
- `inventory` ✅ — rolling stock per (warehouse, variant)
- `inventory_batches` ✅ — one delivery, with its own expiry
- `stock_movements` ✅ — append-only ledger; every quantity change writes one
- `stock_reservations` ✅ — stock held for a checkout, with an expiry

## Why both `inventory` and `inventory_batches`

`inventory` is a rolling total kept alongside the batch rows it summarises. Sellable quantity
has to be answerable in one indexed read on every product page, which summing batches cannot
do. `stock_movements` is the ledger that makes the two reconcilable — without it a
discrepancy is visible but unexplainable.

Available to sell = `quantityOnHand - quantityReserved`. Reserved stock is physically present
but promised to a checkout in progress.

## Constraints live in Postgres, not only in code

`quantity_on_hand >= 0`, `quantity_reserved >= 0` and `quantity_reserved <= quantity_on_hand`
are CHECK constraints. An oversell that only the application prevents is one forgotten code
path away from happening.

Every foreign key is `RESTRICT`: a warehouse or variant that ever held stock is deactivated,
never deleted, or its history stops being resolvable. The one exception is
`stock_movements.batch_id`, which is `SET NULL` so a written-off batch can be purged while
its ledger entry survives.

## Reservations expire

A hold is taken when checkout starts and released when `expires_at` passes. A hold with no
expiry leaks stock permanently on every abandoned payment — the `(released_at, expires_at)`
index exists so the sweep is cheap.

## Design notes

- Stock writes are transactional with orders. A decrement that is not part of the order transaction will oversell.
- Batch expiry is the reason this module exists: doi and rosmalai are unsellable within hours, not days.
- Never expose a write path to `anon`/`authenticated` — this table is service_role only.

## Batches fall with the aggregate

`inventory.quantity_on_hand` and the sum of `inventory_batches.quantity` for the same
warehouse/variant must move together. `consumeFefo` in `batch-consumption.ts` is the one place
that draws stock off batches, and **both** callers use it: manual adjustments and order
dispatch.

They did not always. Dispatch used to decrement only the aggregate, so every sale widened a
gap between the two, and expiry picking kept selecting batches that had already been sold.
`prisma/sql/local/check-batch-drift.sql` is a read-only diagnostic for that damage.

## One movement per batch

A stock movement names the batch its units came off (`batch_id`). That is what makes "which
orders received batch X" answerable, which is the entire reason a grocery tracks expiry at
all. A line spanning two batches writes two movements whose deltas still sum to the quantity
that left.

When no batch covers the quantity — a variant that is not batch-tracked, or batch records
behind the shelf — the remainder is written as a movement with a null `batch_id` rather than
dropped, so the ledger still sums to what actually moved.

## Before writing code here

Copy the shape of `src/modules/catalog` — controller → service → repository,
with the mapper owning the wire format and constants in `<module>.constants.ts`.
The rules that apply to every module are in the repository README under
**Conventions**; the ones this module will get wrong if skipped:

1. Every public method on the controller, service and repository wraps its body
   in `try`/`catch` and logs with the error object first.
2. Services return `ServiceResponse<T>`; only the controller turns that into an
   HTTP status, via `unwrapOrThrow`.
3. Money is integer poysha (`BigInt`), converted to a number only in the mapper.
4. Unit tests for every layer this module touches, in the same commit.
5. Enable RLS on any table added here, in `prisma/rls/`, in the same commit.
