# Inventory module

**Status:** planned — Phase 1

Stock per hub, batch and expiry tracking, low-stock and expiring-batch alerts.

## Owned tables

- `inventory`
- `inventory_batches`
- `warehouses`

## Design notes

- Stock writes are transactional with orders. A decrement that is not part of the order transaction will oversell.
- Batch expiry is the reason this module exists: doi and rosmalai are unsellable within hours, not days.
- Never expose a write path to `anon`/`authenticated` — this table is service_role only.

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
