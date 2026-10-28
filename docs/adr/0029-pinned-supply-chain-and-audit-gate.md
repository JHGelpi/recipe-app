# 0029. Actions and images pinned by hash; CI fails on high advisories

- **Status:** Accepted
- **Date:** 2026-10-28

## Context
CI used Actions by moving tags (`actions/checkout@v7`) and declared no `permissions:`, so a moved tag would run with the repository's default token. A moved tag is how tj-actions/changed-files was compromised in 2025. Images were pinned to versions (ADR-0024), but a version tag can still be pushed again. The weekly audit (ADR-0024) reports advisories, but nothing stopped a PR from adding one (issue #69).

## Decision
- **Actions are pinned to full commit SHAs,** with the version in a comment. `ci.yml` declares `permissions: contents: read`.
- **Images are pinned as `tag@sha256:digest`** in the Dockerfiles and Compose files. The tag stays for readers and for Dependabot, which updates the tag and digest together, as it does the SHA and comment for Actions.
- **CI's `static` job runs `pnpm audit --prod --audit-level high`.** A high or critical advisory in production dependencies fails the PR.
- **Fixes go in `pnpm-workspace.yaml`:** `overrides:` forces a fixed version within the same major. `node-forge` is forced to 1.4.1 or later, under Expo's code signing.
- **Ignoring an advisory needs a reason:** `auditConfig.ignoreGhsas` lists advisories the gate skips. Each one must be in build-time tooling with no fix in its major, and has a comment saying why. The first entry is zod 3's advisory (GHSA-mrhx-c7xc-m3w5) in `@expo/cli`. Its fix is zod 4, a major that Expo has not adopted.
- **Moderate advisories are not gated.** They appear in the weekly audit. Today that means `uuid` (iOS project tooling) and `decode-uri-component` (expo-router's query parsing, a client-side ReDoS). Each needs a major the parent package hasn't taken.

## Alternatives considered
- **Renovate instead of Dependabot:** better digest handling, but a second bot and app to trust. Dependabot already updates SHA- and digest-pinned refs.
- **Allow-listing in a script rather than pnpm's `ignoreGhsas`:** more code for what pnpm already does.
- **Overriding zod to 4 under `@expo/cli`:** a major change to a build tool's validation library, for an advisory that only affects input the build gives it.

## Consequences
- A new high advisory makes every PR red until it is fixed or deliberately listed. Dependabot's own PRs can be red for the same reason.
- Pins are unreadable without their comments. Edits by hand must update both; the RUNBOOK says how.
- The ignore list must shrink when Expo updates. The weekly audit run is the place to notice.
