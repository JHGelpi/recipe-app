# 0006. Household tenancy via shared schema + RLS

- **Status:** Accepted, amended by 0008
- **Date:** 2026-10-12

## Context
Each household is a tenant with multiple users and three roles (Admin, Member, Viewer). No household may see another's data (NFR-1). Expected scale: tens to low thousands of households.

## Decision
**Shared database, shared schema.** Every tenant-owned table has a non-null `household_id`. Postgres **Row-Level Security** policies restrict all access to `household_id = auth_household_id()`; write policies additionally require `auth_household_role()` to be `admin` or `member`. Storage paths are prefixed `households/{household_id}/` with matching bucket policies. The JWT carries `household_id` and `household_role` as custom claims added by GoTrue's access-token hook (`role` is used by GoTrue itself).

Cross-household operations (importing a shared recipe) go through the Share Service, which copies an immutable snapshot and is the only audited use of elevated privileges.

## Alternatives considered
- **Schema per tenant:** stronger isolation, painful migrations and sync rules at scale.
- **Database per tenant:** overkill for this scale and cost.
- **App-level filtering only:** one missed `WHERE` clause leaks data.

## Consequences
- An automated isolation test suite (two households, all roles, every table) is mandatory in CI.
- Supporting multiple households per user later means changing the claim to an active-household selection plus a membership check in policies.
