# 0033. Production on the PC runs on rootless Podman in its own WSL distro

- **Status:** Accepted
- **Date:** 2026-11-16
- **Amends:** ADR-0018 (the container runtime on the PC)

## Context

ADR-0018 runs production on the owner's Windows PC under Docker Desktop. The owner wants to stop depending on Docker Desktop, with no data loss and no changes to the stack or to `pnpm prod:*`.

The compose files use `!reset` and `!override`, which podman-compose doesn't support. Podman Desktop's VM can't see bind mounts from the Linux home where `~/dishkept` lives (ADR-0018 keeps it off the Windows drives).

## Decision

1. **A separate WSL distro, `Ubuntu-24.04`,** holds production: rootless Podman 4.9, with systemd on and the Windows PATH kept out (`/etc/wsl.conf`). The production clone is `~/dishkept` there. `scripts/podman/setup-host.sh` sets the distro up and is safe to run again.
2. **The Docker CLI and Compose plugin stay as the client.** They reach Podman through its API socket (`DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock`). `scripts/prod/*` still call `docker compose` and are unchanged. Images build through buildx.
3. **Coming back after a reboot:**
   - A Task Scheduler task, "Dishkept Podman", runs `wsl.exe -d Ubuntu-24.04 --exec sleep infinity` at startup and at sign-in, so the distro stays up.
   - Linger is on, and the user units `podman.socket` and `podman-restart.service` are enabled.
   - Podman 4.9's restart service starts only `restart: always` containers, but compose uses `unless-stopped`. A drop-in also starts compose containers with `unless-stopped` unless they were stopped on purpose (`State.StoppedByUser`), as Docker does. So a stack stopped by `prod:stop` stays down.
4. **The cutover** used the existing tools: a `prod:restore-test` drill on Podman, then `prod:backup-now` and `prod:stop` on Docker, and `prod:restore` on Podman.

## Alternatives considered

- **Podman Desktop:** its VM can't see `~/dishkept`'s bind mounts.
- **podman-compose:** no `!reset` or `!override`.
- **Podman in the existing distro:** that distro also runs the dev stack on Docker Desktop. Two engines sharing one distro risk dev commands reaching production.
- **Staying on Docker Desktop:** works, but it's the dependency the owner wants gone.

## Consequences

- Production no longer needs Docker Desktop. Its old `dishkept_*` volumes stay as a rollback (`prod:stop` on Podman, `prod:start` on Docker) until Podman has a few weeks of good backups and a monthly drill.
- Run `ansible-playbook site.yml -l pc` from inside `Ubuntu-24.04`: the `pc` host is the local machine. The `serve` role now checks the Podman restart setup and the scheduled task instead of Docker Desktop's AutoStart.
- The scheduled task's at-startup run (S4U, nobody signed in) hasn't been shown to work. Until someone signs in after a reboot, the site may be down, as it was with Docker Desktop.
- The VM path (ADR-0021's `docker` role) is unchanged: Docker Engine there.
- The dev stack still uses Docker Desktop.
