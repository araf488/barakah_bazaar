# Search module

**Status:** implemented inside the Catalog module — Postgres full-text search. This module stays planned for when that stops being enough.

Full-text and faceted product search.

## Owned tables

_None._ The search index is a `GENERATED ALWAYS` column on `products`, owned by Catalog.

## How search works today

`GET /catalog/products?search=...` takes a different path from browsing. Ranking lives in SQL,
so the page is cut from an ordered id list rather than from a Prisma `orderBy` that has no
notion of relevance — offering "best match" and returning "newest" is worse than not offering
it at all.

Two strategies, unioned, because they fail in opposite directions:

| Strategy                            | Handles                                 | Misses                  |
| ----------------------------------- | --------------------------------------- | ----------------------- |
| `tsvector` + `websearch_to_tsquery` | word forms, multi-word queries, phrases | misspellings            |
| `pg_trgm` `similarity()`            | misspellings ("almnod")                 | long text, ranks poorly |

`products.search_vector` is **`GENERATED ALWAYS ... STORED`**, so it cannot drift from the
columns it summarises — a trigger can be forgotten in one write path, a generated column
cannot. Weights are A for names, B for brand, C for descriptions, so a product _named_
"almond" outranks one that merely mentions almonds in its description.

**Everything is indexed with the `simple` configuration, including English.** Postgres ships no
Bengali stemmer, and running Bengali through the `english` one mangles the tokens. `simple`
lowercases and splits, which is right for a language the database does not understand. The
cost is losing English stemming, which the trigram pass compensates for.

The service hydrates through Prisma and then **restores the rank order in memory**: `WHERE id
IN (...)` returns rows in whatever order Postgres finds convenient, so hydrating without
re-sorting silently discards the ranking that was just computed. A test asserts exactly that.

## What would justify this module existing

**Transliteration is the real gap.** "chini" does not find "চিনি", and "almond" does not find
"কাঠবাদাম". Postgres cannot do that without a mapping, and a Bangladeshi customer typing
Bengali words in Latin script is the normal case, not an edge one. The answers are a curated
synonym dictionary or a Bengali-aware engine.

Other things Postgres will eventually stop being enough for:

- Facet counts (how many almonds are under 500 taka) without a second aggregate query per facet.
- Typo tolerance that ranks rather than merely matches — trigram similarity is a filter, not a
  relevance signal.
- Target if it comes to that: Typesense or Meilisearch, populated by a queued indexer that
  follows product writes. Both have free self-hosted tiers.

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
