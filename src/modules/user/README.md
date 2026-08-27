# User module

**Status:** planned — Phase 1

Profiles, address book, saved payment-method references.

## Owned tables

- `users`
- `addresses`

## Design notes

- Address CRUD scoped to the owner — never trust a userId from the request body.
- Structured Bangladesh addresses (division / district / upazila) validated against a reference dataset, not free text.
- Default-address selection must be atomic: setting one default clears the previous in the same transaction.

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
