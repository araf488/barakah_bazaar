# Order module

**Status:** planned — Phase 1

Checkout and the order state machine.

## Owned tables

- `orders`
- `order_items`
- `order_status_history`

## Design notes

- State machine: Placed → Confirmed → Packed → Out for Delivery → Delivered, with Cancelled and Returned as terminal branches. Transitions are validated, not assigned.
- Checkout revalidates price, stock and promotion eligibility inside one transaction before writing the order.
- Requires an idempotency key: a retried checkout must not create a second order.
- Every transition appends to order_status_history — that history is the audit trail.

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
