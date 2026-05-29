# Malaf

Malaf is a self-hosted SvelteKit and Go application for private, anonymous-by-design, one-time 1-to-1 encrypted file sharing at `malaf.alaobeidat.com`.

It has no accounts, no database, no plaintext filenames, and no intentional persistent request logs. The browser encrypts files into the MALAFv1 AES-256-GCM format before upload. The backend stores only opaque ciphertext and removes it on the first download attempt or after 30 minutes.

## What Malaf Protects Against

- Server disk disclosure of stored file contents.
- Backend access to plaintext file contents, plaintext filenames, and MIME types.
- Accidental file history caused by accounts, database rows, or download records.
- Concurrent download races: exactly one request can atomically claim a file.
- Forgotten encrypted files: unclaimed files are cleaned after 30 minutes.

## What Malaf Does Not Protect Against

- A compromised server serving malicious JavaScript to future visitors.
- A malicious operator changing the frontend or deployment pipeline.
- Anyone who receives the full share URL, because the fragment contains the decryption key.
- Network timing, ciphertext size, IP metadata, and traffic-correlation attacks.
- Browser, extension, OS, clipboard, or endpoint compromise.
- Content moderation and virus scanning. The server cannot decrypt uploads.

Web crypto depends on receiving uncompromised JavaScript from the server. This is the core limitation of browser-delivered cryptography.

## Local Development

Backend:

```bash
cd backend
go test ./...
MALAF_ADDR=127.0.0.1:8081 \
MALAF_FILES_DIR="$PWD/.data/files" \
MALAF_CLAIMED_DIR="$PWD/.data/claimed" \
MALAF_UPLOADS_PER_HOUR=1000 \
go run .
```

Frontend:

```bash
cd frontend
npm ci
npm run check
npm run test
npm run build
npm run dev -- --host 127.0.0.1 --port 4173
```

End-to-end:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

## API

- `POST /api/upload?fileId={uuidv4}` accepts MALAFv1 ciphertext only.
- `GET /api/stat/{fileId}` returns existence and encrypted byte size.
- `GET /api/download/{fileId}` atomically claims, unlinks, and streams the ciphertext once.
- `GET /api/health` returns a health response.

The decryption key is never sent to the backend. Share links use:

```text
https://malaf.alaobeidat.com/d/{fileId}#{secretKey}
```

## Deployment

On a fresh Hetzner Ubuntu LTS VPS:

```bash
sudo ./deploy/install-server.sh
```

From your workstation:

```bash
export MALAF_DEPLOY_HOST=root@YOUR_SERVER_IP
./deploy/deploy.sh
```

The deploy script builds the static frontend, compiles the Go backend for Linux AMD64, syncs `/var/www/malaf`, installs `/opt/malaf/malaf`, and restarts systemd/Caddy.

Do not configure backups for `/var/lib/malaf`. Backups violate the ephemerality promise. Keep `/var/lib/malaf/files` and `/var/lib/malaf/claimed` on the same filesystem so atomic rename claims remain valid.

## Cloudflare Modes

Privacy-first: set DNS to DNS Only / grey cloud. Caddy terminates TLS on Hetzner. Cloudflare sees less traffic metadata, but the origin IP is public.

Protection-first: set DNS to Proxied / orange cloud. Cloudflare improves DDoS/WAF coverage, but can observe visitor IP addresses, request paths, user agents, timing, and encrypted file sizes. Disable API caching, Rocket Loader, Auto Minify, Email Obfuscation, and any HTML/JS rewriting. Do not call this mode fully anonymous.

## Verify Deletion

Upload a file, download it once, then check:

```bash
sudo find /var/lib/malaf/files /var/lib/malaf/claimed -maxdepth 1 -type f -print
```

The downloaded file should not remain. For expiry, wait longer than `MALAF_FILE_TTL` and confirm old files disappear after the cleanup interval.

## Rotate Or Redeploy Safely

Build and deploy a new binary/static bundle with `deploy/deploy.sh`. Existing encrypted files remain decryptable if the JavaScript format stays compatible. For breaking crypto-format changes, use a new format magic/version and keep old download support until all old 30-minute files have expired.
