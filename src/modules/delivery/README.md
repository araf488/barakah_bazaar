# Delivery module

**Status:** pricing implemented — Phase 1. Slots, hubs and courier integration remain Phase 4/5.

What it costs to deliver a basket to an address.

## Owned tables

- `delivery_zones`
- `delivery_zone_rules`

Still planned: `delivery_slots`, `shipments`, `courier_tracking`, `hubs`.

## Why this exists

Before it, `OrderService` had `const deliveryFee = 0n` with a comment deferring pricing to
Phase 4 — so every order in the country shipped free. The column was already on the order, so
this fills it rather than migrating history.

## Zones are priced, not places

"Inside Dhaka city", "Greater Dhaka", "rest of Bangladesh" are three fees, and each collects
however many divisions, districts or units belong to it. Modelling it the other way round — a
fee per district — makes a nationwide price change 64 edits and guarantees they drift.

## Specificity decides

A rule naming a **unit** beats one naming only its **district**, which beats one naming only
the **division**. That is what lets

> Dhaka division 120, except Dhaka district 80, except Gulshan 60

be three rows rather than a special case. Specificity is **counted**, not inferred from query
order, and a test runs the same rule set forwards and backwards to prove the answer does not
move.

All candidate rules come back in one query and the winner is picked in memory. The candidate
set is tiny, and doing it this way keeps the precedence rule in one readable place instead of
spread across three round trips.

## It fails closed

When no rule matches and no default zone is configured, `resolveFee` returns a failure and
**checkout refuses the order**. It does not fall back to zero. A silent zero is a revenue leak
nobody notices; a refused order is loud and gets fixed the same day.

The practical consequence: **until `apply-delivery-zones.sql` has run, every checkout fails.**
The seed in that file is not decoration.

## The fee is never taken from the client

The quote endpoint is advisory — it exists so the basket can show a number before the customer
commits. Checkout resolves the fee again, server-side, from the address actually ordered to. A
delivery charge the customer can choose is a delivery charge the customer will choose to be
zero.

## Guarantees the database enforces

| Guarantee                       | How                                                     |
| ------------------------------- | ------------------------------------------------------- |
| One place belongs to one zone   | `UNIQUE (division, district, unit) NULLS NOT DISTINCT`  |
| At most one default zone        | partial unique index `ON (is_default) WHERE is_default` |
| A unit rule names its district  | `CHECK (unit IS NULL OR district IS NOT NULL)`          |
| No negative fee                 | `CHECK (fee_poysha >= 0)`                               |
| No zero free-delivery threshold | `CHECK (free_above_poysha IS NULL OR > 0)`              |

`NULLS NOT DISTINCT` is load-bearing and needs **Postgres 15+**. Postgres treats NULLs as
distinct in a unique index by default, so without it `('Dhaka', NULL, NULL)` could be inserted
twice and two zones would both claim the whole division — the most common kind of rule there
is.

## Places are validated against the geography dataset

Every name in a rule is checked through `GeoService` on write. A typo'd district matches no
address and quietly bills everyone there the default rate, which is invisible in production.

`seed-zones.spec.ts` goes further and validates the **seed SQL itself** against the dataset, so
a rename on either side breaks the build rather than the pricing. It caught the seed naming
`Chittagong`, which is not in the dataset — the district is `Chattogram`.

## Admin

`SUPER_ADMIN` and `OPS`: pricing is money, and OPS runs fulfilment. Every write goes through
the shared audit trail in one transaction, and a failed audit row refuses the change.

Updating a zone **replaces its whole rule set** rather than diffing it. A partial rule update
is how a place ends up in two zones or none, and the set is small enough that rewriting it is
cheaper than reasoning about which half applied.

## Cold chain and delivery reach

`products.max_delivery_distance_km`, `is_perishable`, `storage_type`, `shelf_life_hours` and
`warehouses.service_radius_km` all existed as columns that **nothing read**. Admin wrote them,
the catalog returned them, and no decision anywhere consulted them — a frozen item with a 5 km
limit could be ordered to Manikganj. `delivery-reach.ts` and the checkout rules make the first
two load-bearing.

Two limits, enforced **differently**, because they mean different things:

| Limit                               | Kind                | Unmeasurable distance              |
| ----------------------------------- | ------------------- | ---------------------------------- |
| `warehouses.service_radius_km`      | commercial boundary | **passes**                         |
| `products.max_delivery_distance_km` | cold-chain safety   | **falls back to a district match** |

That asymmetry is the important decision. Addresses carry coordinates only when the customer
pasted a map link, so most orders cannot be measured at all.

- Refusing everything unmeasurable would reject orders that succeed today — a regression
  dressed as a rule. So the hub's commercial radius lets it through.
- Treating unmeasurable as fine would leave the cold-chain limit decorative, which is exactly
  the state being replaced. So a perishable falls back to "same district as the hub" — the
  coarsest honest proxy for _close enough to arrive cold_, and the only one needing no
  coordinates.

Warehouse selection now takes the destination: a hub must have the stock **and** be able to
reach the address. When every hub is ruled out by a perishable rather than by stock, the
refusal **names the item**, because the customer's only useful action is to remove it.

### Still decorative

`storage_type` and `shelf_life_hours` are written and read but drive nothing. Warehouses have
no storage-capability field, so nothing stops a frozen line being picked from an ambient-only
hub, and shelf life does not seed batch expiry. Both need a schema change; neither is bluffed
here.

## Conventions this module follows

1. Every public method wraps its body in `try`/`catch` and logs with the error object first.
2. Services return `ServiceResponse<T>`; only the controller turns that into an HTTP status.
3. Money is integer poysha (`BigInt`), widened only in the mapper.
4. Unit tests for every layer this module touches.
5. RLS enabled and forced on both tables, with **no policy at all** — a deny.
