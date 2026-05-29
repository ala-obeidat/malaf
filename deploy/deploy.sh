#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
host="${MALAF_DEPLOY_HOST:?Set MALAF_DEPLOY_HOST, for example root@203.0.113.10}"

cd "${repo_root}/frontend"
npm ci
npm run check
npm run test
npm run build

cd "${repo_root}/backend"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "${repo_root}/deploy/malaf" .

rsync -az --delete "${repo_root}/frontend/build/" "${host}:/var/www/malaf/"
rsync -az "${repo_root}/deploy/malaf" "${host}:/opt/malaf/malaf"
rsync -az "${repo_root}/deploy/Caddyfile" "${host}:/etc/caddy/Caddyfile"
rsync -az "${repo_root}/deploy/malaf.service" "${host}:/etc/systemd/system/malaf.service"

ssh "${host}" "chown root:root /opt/malaf/malaf && chmod 0755 /opt/malaf/malaf && systemctl daemon-reload && systemctl restart malaf && systemctl reload caddy"

rm -f "${repo_root}/deploy/malaf"
