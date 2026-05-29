#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root on the Ubuntu server." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl rsync caddy

if ! id malaf >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/malaf --shell /usr/sbin/nologin malaf
fi

install -d -o malaf -g malaf -m 0700 /var/lib/malaf
install -d -o malaf -g malaf -m 0700 /var/lib/malaf/files
install -d -o malaf -g malaf -m 0700 /var/lib/malaf/claimed
install -d -o root -g root -m 0755 /opt/malaf
install -d -o root -g root -m 0755 /var/www/malaf

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -o root -g root -m 0644 "${script_dir}/malaf.service" /etc/systemd/system/malaf.service
install -o root -g root -m 0644 "${script_dir}/Caddyfile" /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable malaf.service
systemctl enable caddy.service

echo "Install complete. Deploy the binary and frontend, then run:"
echo "  systemctl restart malaf"
echo "  systemctl reload caddy"
