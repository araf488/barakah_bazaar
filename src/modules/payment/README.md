# Payment module

**Status:** planned — Phase 1 (bKash + COD), Phase 5 (rest)

bKash, Nagad, Rocket, SSLCommerz and Cash on Delivery.

## Owned tables

- `payments`
- `payment_transactions`

## Design notes

- One adapter per gateway behind a common interface (strategy pattern); the order module must not know which gateway ran.
- Webhooks verify the gateway signature before anything else, and are idempotent by gateway reference.
- Amounts are integer poysha end to end. Reconcile the gateway's amount against the order's before marking it paid.
- Never log a token, card number or PIN — not even at debug.

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
