# Product Specification

> Status: **Draft v0.2** · Last updated: 2026-10-17
> Source of truth for *what* we build. `ARCHITECTURE.md` covers *how*.

## 1. Vision

The app is named **Dishkept** (ADR-0017).

A shared household cookbook that pulls every recipe out of the places it's scattered (Google Drive, iCloud, Notes, cookbooks, websites), cleans it up automatically with AI, and makes it instantly findable — then helps you shop and plan from it.

**Core problem:** recipes are fragmented across many tools, inconsistently formatted, and hard to search.

**Success looks like:** every recipe the household cares about lives in one place, can be found in seconds (e.g. "all chicken recipes"), and is easy to cook from on a phone.

## 2. Users & tenancy

- **Tenant = household.** Each household has its own private recipe collection. Data never crosses households except through explicit sharing.
- **Each user belongs to exactly one household in v1** *(assumption — confirm)*.

| Role | Can do |
|---|---|
| **Admin** | Everything a Member can, plus invite/remove users and change roles |
| **Member** | Add, import, edit, delete recipes; use AI features |
| **Viewer** | Browse, search, cook, share recipes out. No edits. |

Outside the household:
- **Recipient** — receives a shared recipe (PDF/text or import link). May or may not have an account.
- **New household** — someone invited to use the app with their own separate household.

## 3. Scope & phasing

| Phase | Theme | Contents |
|---|---|---|
| **1 (v1)** | Recipe repository | Import, AI parsing, edit, tags, search, cook mode, substitutions, sharing, offline |
| 2 | Shopping list *(built)* | Add ingredients from recipes, merge duplicates, group by aisle |
| 3 | Meal planning | Weekly dinner menu feeding the shopping list |
| Future | Desktop app; natural-language / semantic search | |

**Platforms (v1):** web first, as an installable web app built with Expo; native iOS and Android later from the same codebase (ADR-0007). Desktop later.

**Out of scope (v1):** bulk import/migration; importing from social video itself (only recipes written in post comments, via paste); public recipe community; multiple households per user.

## 4. Core user journeys (Phase 1)

1. **Capture from photo** — snap or pick one or more photos of a cookbook page or recipe card → AI extracts the recipe → review → save.
2. **Import a link** — share a URL from the browser to the app (or paste it) → recipe arrives without blog clutter → review → save.
3. **Paste text** — paste from Notes or a social media comment → structured recipe → review → save.
4. **Find** — search "chicken" → every recipe with chicken in the title, ingredients, or tags; combine with tag filters.
5. **Cook** — open a recipe → cook mode keeps the screen awake, scales servings, offers substitutions.
6. **Share out** — send a recipe as a formatted PDF or text by text message/email, or send an import link so the recipient saves a copy to their own household.
7. **Invite** — Admin invites a family member to the household, or invites someone to start their own household.

## 5. Functional requirements (Phase 1)

Priority: **M** = must for v1, **S** = should, **C** = could. Items marked *(proposed)* were suggested during design and still need confirmation.

### Households & users
| ID | Requirement | Pri |
|---|---|---|
| FR-1 | Sign up / sign in with an email one-time code. Sign-up is limited to allowed addresses and invited people (ADR-0018) | M |
| FR-2 | Creating an account creates a household; creator becomes Admin | M |
| FR-3 | Admin invites people into the household by text or email link *(built in sub-project 6)* | M |
| FR-4 | Roles: Admin, Member, Viewer with permissions per §2 | M |
| FR-5 | Admin can change roles and remove members *(built in sub-project 6)* | M |
| FR-6 | Any user can invite someone to create their own household *(built in sub-project 6; friend links in the production sub-project)* | S |

### Capture & import
| ID | Requirement | Pri |
|---|---|---|
| FR-7 | Import from photo (camera or library), multiple pages per recipe *(built in 4b: up to 8 pages)* | M |
| FR-8 | Import from URL via paste; via OS share sheet on native builds only (ADR-0007) | M |
| FR-9 | Import from pasted text (incl. social media comments) | M |
| FR-10 | AI parses: title, ingredients (qty / unit / item / prep note), steps, servings, prep & cook time, suggested tags | M |
| FR-11 | Review screen before save; low-confidence fields highlighted | M |
| FR-12 | Original photo(s) or URL stored and viewable on the recipe | M |
| FR-13 | Re-parse from original *(proposed)* | S |
| FR-14 | Duplicate warning on import *(proposed)* | C |

### Recipe management
| ID | Requirement | Pri |
|---|---|---|
| FR-15 | Edit all fields; personal notes (shared with the household). One dish photo per recipe (4b) | M |
| FR-16 | Tags: free-form, with suggestions from the household's tags; AI suggestions arrive with import | M |
| FR-17 | Favorites (per user) | S |
| FR-18 | 30-day trash before permanent delete | S |

### Search
| ID | Requirement | Pri |
|---|---|---|
| FR-19 | Search by title, ingredient, tag; combinable filters. Steps and notes are not searched yet | M |
| FR-20 | Search works offline | M |

### Cooking
| ID | Requirement | Pri |
|---|---|---|
| FR-21 | Cook mode: screen awake, large text, step-by-step, checkable ingredients | M |
| FR-22 | Scale servings | S |
| FR-23 | US ↔ metric conversion (same kind only: volume ↔ volume, weight ↔ weight) | C |
| FR-24 | AI substitutions per ingredient, with amounts and effect on dish | M |
| FR-25 | Save a substitution to the recipe as a note | C |

### Sharing out
| ID | Requirement | Pri |
|---|---|---|
| FR-26 | Share recipe as formatted PDF or plain text via OS share sheet *(built in sub-project 7)* | M |
| FR-27 | Share import link; recipient saves a copy into own household (sign-up prompt if needed) *(built in sub-project 7)* | M |

### Offline & sync
| ID | Requirement | Pri |
|---|---|---|
| FR-28 | View, search, create, edit offline | M |
| FR-29 | Imports captured offline are queued and parsed when online | M |
| FR-30 | Sync across household devices; last save wins | M |

### Shopping list (Phase 2)

| ID | Requirement | Pri |
|---|---|---|
| FR-31 | One shopping list per household, shared and synced; works offline | M |
| FR-32 | Add a recipe's ingredients at the viewed servings, choosing which ones | M |
| FR-33 | Same items merge into one line, adding amounts where units allow; the line shows its recipes | M |
| FR-34 | Items are grouped by aisle: a built-in guess, overridden by the household's own choices | M |
| FR-35 | Tick items off while shopping, clear ticked items, remove items, add typed items. Clear ticked removes fully ticked lines; a partly ticked line stays, counting what is left | M |

## 6. Non-functional requirements

> **Draft — not yet reviewed.** Targets are starting proposals.

| ID | Area | Requirement |
|---|---|---|
| NFR-1 | Tenant isolation | No user can read or write another household's data. Enforced in the database, not only in app code. Covered by automated tests. |
| NFR-2 | Privacy | Recipe photos and data are private to the household by default. Shared links expose only the shared recipe snapshot. |
| NFR-3 | Security | No secrets (AI keys, service keys) on the device. All AI and URL-fetch calls run server-side. |
| NFR-4 | Offline | All read, search, create, edit work with no connectivity. AI features degrade gracefully with a clear message. |
| NFR-5 | Sync latency | Online edits visible on other household devices within ~10 s. |
| NFR-6 | Performance | Cold start < 2 s on a mid-range phone; local search < 300 ms over 2,000 recipes; photo parse < 30 s p90. |
| NFR-7 | AI cost | Per-household monthly AI spend tracked and capped: $2.00 by default (`AI_MONTHLY_CAP_USD`). |
| NFR-8 | Availability | Best effort on a home PC; move to a VM when uptime matters (ADR-0018). |
| NFR-9 | Data durability | Nightly encrypted off-site backups kept 30 days; restore tested (ADR-0018). No data loss on device reinstall once synced. |
| NFR-10 | Portability | Household can export all recipes (JSON + PDFs). |
| NFR-11 | Accessibility | Supports OS dynamic text size, VoiceOver/TalkBack, WCAG AA contrast. |
| NFR-12 | Store compliance | Native builds only: in-app account deletion; Sign in with Apple offered on iOS if other social sign-in is offered. |
| NFR-13 | Attribution | Imported web recipes retain source URL and author attribution. |

## 7. Open questions

1. Confirm one-household-per-user for v1.
2. Confirm or cut the *(proposed)* FRs.
3. Review NFR targets. The AI cap is set at $2.00 per household per month; revisit with monetization.
4. ~~Working app name.~~ Dishkept (ADR-0017).
5. Monetization, if any, once other households join (affects AI quota design).
