# Review module

**Status:** implemented — ratings, verified-purchase reviews and the moderation queue. Review images remain unbuilt.

Ratings, verified-purchase reviews, moderation queue.

## Owned tables

- `reviews` ✅
- `review_images` — **not built.** See _Not built_ below.

It also owns `products.rating_sum` and `products.rating_count`.

## Verified purchase is a property of the schema

A review hangs off an **order line**, not a product, and `order_item_id` is `UNIQUE`. So a
customer can review each delivered line exactly once, and a product they never bought cannot
be reviewed at all. There is no `productId` in the create payload — the product is read off the
line — so the API has no way to express reviewing something you did not receive.

`isVerifiedPurchase` is hardcoded `true` in the mapper rather than stored, for the same reason:
a column would be a second source of truth able to disagree with the foreign key.

Three refusals, and two of them answer identically on purpose: a line belonging to someone else
returns the same 404 as a line that does not exist, so the endpoint cannot be used to probe
other customers' orders.

## Nothing is public until a human reads it

Reviews are created `PENDING`. For a halal grocery an unmoderated claim about a product's
provenance, or a food-safety complaint, appearing unread on the storefront is a trust and
liability question rather than a spam one.

The RLS policy is on **status, not ownership** — an unmoderated review is unreadable by anyone
but the service role, including its own author through a direct PostgREST client. The author
sees their pending review because this API hands it back on create.

`moderation_note` is internal and never returned to a customer.

## The rating cannot drift

Stored as **`rating_sum` + `rating_count`**, not an average. Integer arithmetic cannot drift,
and a stored float would round differently from the number a recount produces.

More importantly it is **recomputed from the published rows**, never incremented, inside the
same transaction as the moderation. An increment is how a denormalised aggregate goes wrong: a
publish that runs twice, or one racing a rejection, leaves a number nothing can reproduce.

Division happens once, at the mapper. A product with no published reviews reports `null` rather
than `0` — zero stars is a rating, "not yet rated" is not, and a storefront that renders them
the same punishes every new product.

Two moderators cannot both settle one review: the `UPDATE` filters on `status = PENDING`, so
the loser writes nothing and the rating is recounted once.

## Not built

**Review images.** The README originally specified a `review_images` table and signed uploads
to a `review-images` bucket, mirroring product images. That is a storage flow of its own —
signed URL, object-path scoping, moderation of the image separately from the text — and it is
deliberately left out rather than half-built. No dead table was created for it; it lands with
its own migration.

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
