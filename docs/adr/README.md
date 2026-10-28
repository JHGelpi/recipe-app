# Architecture Decision Records

Lightweight ADRs ([Michael Nygard format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)). One decision per file, numbered, never edited after acceptance. To change a decision, write a new ADR that supersedes the old one.

| # | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-cross-platform-mobile-with-expo.md) | Cross-platform mobile with Expo / React Native | Accepted, amended by 0007 |
| [0003](0003-supabase-as-backend.md) | Supabase as backend platform | Superseded by 0008 |
| [0004](0004-offline-first-sync-with-powersync.md) | Offline-first sync with PowerSync, last-write-wins | Accepted, amended by 0008 |
| [0005](0005-server-side-ai-via-claude-api.md) | Server-side AI via Claude API | Proposed |
| [0006](0006-household-tenancy-with-rls.md) | Household tenancy via shared schema + RLS | Accepted, amended by 0008 |
| [0007](0007-web-first-delivery-via-expo-web.md) | Web-first delivery via Expo web | Accepted |
| [0008](0008-self-hosted-containerized-backend.md) | Self-hosted, containerized backend | Accepted |
| [0009](0009-installable-web-app-with-workbox.md) | Installable web app with a Workbox-generated service worker | Accepted |
| [0010](0010-recipe-content-as-json.md) | Recipe content as JSON on the recipe row | Accepted |
| [0011](0011-in-memory-search.md) | Search with an in-memory index over the local database | Accepted |
| [0012](0012-imports-as-synced-queue.md) | Imports as a synced queue with server-side parsing | Accepted |
| [0013](0013-photo-files-on-a-volume.md) | Photo files on a volume behind RLS-checked endpoints | Accepted |
| [0014](0014-cook-mode-and-substitutions.md) | Cook mode on the phone; substitutions asked live and remembered | Accepted |
| [0015](0015-household-moves-and-live-roles.md) | Household moves through narrow definer functions; live role checks | Accepted |
| [0016](0016-shared-recipe-snapshots.md) | Shared recipe snapshots, read anonymously through a definer function | Accepted |
| [0017](0017-dishkept-design-system.md) | Dishkept: a small design system of our own, dark only | Accepted |
| [0018](0018-production-on-a-home-pc.md) | Production on a home PC: Cloudflare Tunnel, nightly encrypted backups to GCS, invite-only sign-up | Accepted |
| [0019](0019-shopping-list.md) | Shopping list: added rows merged on screen, aisles by word list and household choices | Accepted |
| [0020](0020-light-mode-with-css-variables.md) | Light mode with CSS variables, chosen per device | Accepted |
| [0021](0021-infrastructure-as-code.md) | Infrastructure as code: OpenTofu for the cloud, Ansible for the hosts, secrets in Ansible Vault | Accepted |
| [0022](0022-private-ratings-with-household-totals.md) | Private ratings, with household totals kept by a trigger | Accepted |
| [0023](0023-in-app-feedback-filed-as-github-issues.md) | In-app feedback filed as GitHub issues, under an anonymous reporter id | Accepted |
| [0024](0024-weekly-dependency-updates-with-dependabot.md) | Weekly dependency updates with Dependabot, and a weekly audit | Accepted |
| [0025](0025-bounded-sign-up-through-links.md) | Sign-up through links is bounded: one account per share link, 10 pending friend links per person | Accepted |

Template: [`template.md`](template.md)
