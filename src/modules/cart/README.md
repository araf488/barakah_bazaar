# Cart module

**Status:** implemented — Phase 1

Persistent cart for guests and signed-in users, with server-side price computation.

## Owned tables

- `carts`
- `cart_items`

## Design notes

- Prices are recomputed server-side on every read. A client-supplied price is ignored, always.
- Weight-based lines use Money.forWeight(); never multiply a float.
- Guest-to-user cart merge on sign-in: union by variant, summing quantities, capped at available stock.

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
