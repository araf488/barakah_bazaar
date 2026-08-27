# Review module

**Status:** planned — Phase 6

Ratings, verified-purchase reviews, moderation queue.

## Owned tables

- `reviews`
- `review_images`

## Design notes

- Only a delivered order line may be reviewed, one review per line.
- Review images upload straight to the `review-images` Storage bucket via a signed URL; moderate before publishing.
- Aggregate rating is a denormalized column updated on publish, not computed per product page view.

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
