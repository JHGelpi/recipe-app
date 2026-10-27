# 0024. Weekly dependency updates with Dependabot, and a weekly audit

- **Status:** Accepted
- **Date:** 2026-10-27

## Context
Third-party versions are pinned in five places: the Compose files (cloudflared, GoTrue, PowerSync, dbmate, mailpit, Postgres, Node), the Dockerfiles (Node, Postgres, Caddy), the pnpm workspace, the GitHub Actions workflows, and the OpenTofu providers. Nothing told us when they fell behind. The cloudflared bump of 2026-10-27 was found by hand and carried a security fix. Production is a home PC that changes only through `pnpm prod:deploy` (ADR-0018), so an update must arrive as a change to review, never as an automatic upgrade.

Some tags floated (`caddy:2`, `postgres:17`, `node:22-slim`). A rebuild could change them without a commit, and no update tool can propose a change to a tag that never changes.

## Decision
- **Dependabot, configured in `.github/dependabot.yml`,** checks every ecosystem weekly (Mondays 06:00 New York) and opens pull requests. CI runs on each one. Nothing merges or deploys without review.
  - Each ecosystem's minor and patch updates come as one grouped PR. A major update gets a PR of its own.
  - A release must be 5 days old before it is proposed (`cooldown`), so a bad or compromised release has time to be pulled. Security updates skip the wait.
  - **Excluded:** Postgres majors (the data needs `pg_upgrade` or a dump and restore), Node majors (they move with CI's `node-version`), and the packages the Expo SDK fixes together (`expo*`, `@expo/*`, `react*`, `react-native*`, `@types/react`). An SDK upgrade is made with `npx expo install --fix` as its own change (ADR-0007).
  - The OpenTofu providers use the `opentofu` ecosystem, so the lock file keeps `registry.opentofu.org`.
- **Every image tag is exact** (`caddy:2.11.7`, `postgres:17.11`, `node:22.23.4-slim`), so each change is a commit and a PR.
- **A weekly audit** (`.github/workflows/deps-audit.yml`) runs `pnpm audit --prod` on the lock file. High and critical advisories keep one issue, "Dependency audit: high or critical advisories", up to date, and the workflow closes it when they are gone. The audit catches what a bump cannot fix, such as a transitive package an Expo SDK pins. `scripts/deps-audit/report.mjs` formats the issue, and a failed audit fails the run rather than reading as clean.
- **Rollout:** a reviewed, green PR is merged, then `pnpm prod:deploy` (RUNBOOK, "Dependency updates").

## Alternatives considered
- **Renovate:** more flexible (a dashboard issue, finer grouping, updates pnpm's `packageManager` field), but it needs the Mend app on the account or a self-hosted workflow holding a token. Dependabot is built in and needs neither.
- **Custom version-check scripts on a schedule:** we would have to maintain a parser per ecosystem and the PR plumbing that Dependabot already has.
- **Automatic merging of green patch updates:** less work, but production changes would no longer be a choice. At family scale, reviewing a weekly batch is cheap.

## Consequences
- Each Monday may bring a few PRs. Each needs a look at its release notes, especially for GoTrue, PowerSync and cloudflared, where CI shows that the stack works but not that production will behave.
- Expo, React and React Native fall behind until an SDK upgrade, and Postgres and Node until a planned major upgrade. These are deliberate and must be planned.
- Dependabot alerts and security updates are a repository setting (Settings → Code security), not part of this file.
- The audit issue is public, like the repository and its lock file, so anyone could run the same audit. It names packages, not how this app uses them.
