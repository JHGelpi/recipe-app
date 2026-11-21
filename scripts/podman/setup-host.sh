#!/usr/bin/env bash
# Sets up an Ubuntu 24.04 WSL distro to run the stack on rootless Podman (ADR-0033).
# The docker CLI and its Compose plugin stay as the client (the compose files use
# !reset/!override, which podman-compose lacks); they talk to Podman's socket.
# Safe to run again.
set -euo pipefail

. /etc/os-release
[ "$VERSION_ID" = 24.04 ] || { echo "Needs Ubuntu 24.04, found $VERSION_ID" >&2; exit 1; }

# Podman runs healthchecks and restarts through systemd; WSL starts it only when asked.
# The Windows PATH stays out: Rancher/Docker Desktop's docker-credential-* helpers on it
# break the docker client here.
changed=
grep -qs '^systemd=true' /etc/wsl.conf ||
  { printf '\n[boot]\nsystemd=true\n' | sudo tee -a /etc/wsl.conf >/dev/null; changed=1; }
grep -qs '^appendWindowsPath=false' /etc/wsl.conf ||
  { printf '\n[interop]\nappendWindowsPath=false\n' | sudo tee -a /etc/wsl.conf >/dev/null; changed=1; }
if [ -n "$changed" ]; then
  echo 'wsl.conf updated. In PowerShell run: wsl --terminate Ubuntu-24.04, then run this script again.'
  exit 0
fi

sudo apt-get update
sudo apt-get install -y podman uidmap passt slirp4netns ca-certificates curl git

# The docker client only (no engine), from Docker's apt repository.
sudo install -d -m 0755 /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" |
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce-cli docker-compose-plugin docker-buildx-plugin

# Node 22 for pnpm prod:* (Expo needs >=22.13).
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo corepack enable

# Podman's API socket, and containers back after a reboot without anyone signed in to WSL.
sudo loginctl enable-linger "$USER"
systemctl --user enable --now podman.socket
systemctl --user enable podman-restart.service
# Podman 4.9's unit starts only restart: always. Compose uses unless-stopped, so also start
# those, skipping any stopped on purpose (prod:stop), as Docker does; a rollback stays down.
mkdir -p ~/.config/systemd/user/podman-restart.service.d
cat >~/.config/systemd/user/podman-restart.service.d/unless-stopped.conf <<'EOF'
[Service]
ExecStart=/bin/sh -c 'ids=$$(/usr/bin/podman ps -aq --filter restart-policy=unless-stopped --filter label=com.docker.compose.project); [ -z "$$ids" ] || /usr/bin/podman inspect --format "{{if not .State.StoppedByUser}}{{.Id}}{{end}}" $$ids | xargs -r /usr/bin/podman start'
EOF
systemctl --user daemon-reload

line='export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock'
for f in ~/.profile ~/.bashrc; do grep -qxF "$line" "$f" || echo "$line" >>"$f"; done
export DOCKER_HOST="unix://$XDG_RUNTIME_DIR/podman/podman.sock"

docker version --format 'client {{.Client.Version}} / server {{.Server.Version}}'
docker compose version
echo 'Done. Open a new shell so DOCKER_HOST is set.'
