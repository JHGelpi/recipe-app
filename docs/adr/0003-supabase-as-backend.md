# 0003. Supabase as backend platform

- **Status:** Proposed
- **Date:** 2026-10-12

## Context
Need auth (incl. Sign in with Apple), relational data with strong tenant isolation (NFR-1), file storage for photos, and server-side functions for AI (NFR-3). iCloud was considered early but rules out Android users. Family-scale load; cost and ops burden should be low.

## Decision
Use **Supabase**: Postgres (with RLS), Auth, Storage, and Edge Functions (Deno/TypeScript). Local development via the Supabase CLI.

## Alternatives considered
- **iCloud / CloudKit:** Apple-only; incompatible with Android (rejected).
- **Firebase (Firestore):** strong offline story, but document model and security rules are weaker for relational recipe data and tenant-wide queries; heavier vendor lock-in.
- **Self-hosted (Postgres + API on a VPS):** maximum control, but we'd own auth, backups, and uptime.

## Consequences
- Postgres is portable; Supabase can be self-hosted later if needed.
- RLS becomes the primary security boundary and must be tested (see ADR-0006).
- Edge Function cold starts affect import latency slightly; acceptable against NFR-6's 30 s parse target.
