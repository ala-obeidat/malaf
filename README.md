# Malaf

**Malaf** is a fully anonymous, self-hosted, private-by-design **1-to-1** encrypted file handoff PWA. 
No accounts, no databases, no logs, no cookies, and no plaintext metadata. The browser encrypts files locally into the custom `MALAFv1` format using AES-256-GCM before upload, and the server destroys the ciphertext immediately upon the first download attempt or after a 30-minute expiry.

Live: <https://malaf.alaobeidat.com>

---

## What it does

- **Zero-Knowledge Upload**: Encrypts any file (up to 100 MB) client-side in the browser. It generates a random 32-byte secret key and a unique v4 UUID `fileID`.
- **Private Share Link**: Generates a shareable URL containing the secret key in the hash fragment:
  `https://malaf.alaobeidat.com/d/{uuid}#{secretKey}`
  *(Since the fragment is never sent to the server, the operator remains completely blind to the decryption key)*.
- **One-Time Claim**: The recipient opens the link and downloads the file. The server atomically deletes the encrypted payload from disk *before* streaming it to the user.
- **Auto-Purge**: Unclaimed files are automatically destroyed by a background cleanup loop after 30 minutes.

---

## Premium UI/UX Features

| Feature | Description |
|---|---|
| **Adaptive Theme Mode** | Smooth light/dark mode transitions matching system preferences (`prefers-color-scheme`) with a manual overrides persistent switch in Svelte 5. |
| **Glassmorphic Cards** | Visually stunning UI cards designed with `backdrop-filter: blur(16px)` and translucent borders for a futuristic, secure aesthetic. |
| **Pulsing Dropzone** | Interactive drag-and-drop zone that pulses and scales tactfully when dragging a file. |
| **Progress Shimmer** | Advanced linear gradient progress bar featuring an animated shimmer sweep overlay during the local encryption and remote uploading cycles. |
| **Mobile Web Share API** | One-tap native mobile sharing integration, falling back gracefully to a custom animated Clipboard Copy button on desktops. |
| **Detail-Rich Expired Screen** | Clear, security-oriented message cards explaining why a link was expired or claimed to prevent user confusion. |

---

## Security & Privacy Architecture

Malaf is designed with a strict **trustless** mindset. The server cannot access file contents or leak plain metadata even in the event of a full backend compromise.

### Cryptography

| Control | Implementation Details |
|---|---|
| **Encryption Standard** | Web Cryptography API `AES-GCM` with a 256-bit symmetric key. |
| **Key Location** | The 32-byte secret key is contained strictly within the URL hash fragment (`#`). Browsers never include the fragment in HTTP requests; it remains isolated in client memory. |
| **Opaque Metadata** | Plaintext filenames and MIME types are packed into a JSON block and encrypted into the file header using a separate random 96-bit nonce. The server only sees anonymous binary chunks. |
| **Chunked Processing** | Large files are split into `5 MB` chunks. Each chunk is encrypted independently to support low-memory mobile browsers and progressive decryption. |
| **Cryptographic Binding (AAD)** | Every encrypted chunk and the metadata header utilize `Additional Authenticated Data` (AAD) containing the `fileID` and chunk index. This strictly binds every piece of ciphertext to prevent chunk swapping, truncation, or reordering attacks. |
| **Secret Protection** | Key derivation and imports are configured as non-extractable (`extractable: false`). |

### Backend API Hardening

| Control | Implementation Details |
|---|---|
| **Atomic Claiming** | The Go backend uses an atomic `os.Rename(source, claimed)` operation during download. If 20 simultaneous threads attempt to claim the same file, exactly `1` wins and claims the file descriptor while the other `19` instantly receive `410 Gone`. |
| **Path Traversal Prevention** | The file ID parameter is strictly validated against a lowercase v4 UUID regex: `^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`. Any invalid format, path traversal attempt (`../../`), or uppercase character is rejected immediately with HTTP 400. |
| **Automatic Purge** | A background cleanup loop runs constantly, permanently unlinking and deleting unclaimed ciphertexts older than 30 minutes from disk. |
| **Service Worker Isolation** | The PWA service worker explicitly skips caching for any route matching `/api/*`, ensuring encrypted payloads and operational endpoints never pollute local browser caches. |

### Transport Security Headers

Applied directly to all responses via the Caddy configuration layer:

| Header | Value | Purpose |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Forces HTTPS globally, preventing man-in-the-middle downgrade attempts. |
| `Cache-Control` | `no-store` | Disables browser and proxy caching of sensitive API requests, ensuring one-time file transfers are never stored. |
| `X-Content-Type-Options` | `nosniff` | Disables MIME type sniffing. |
| `Referrer-Policy` | `no-referrer` | Ensures that share URLs containing the file ID are never leaked to external sites via `Referer` headers. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | Disables access to device sensors, locations, and integrations globally. |

---

## Codebase Structure

The application is split cleanly into a static, client-side SvelteKit frontend and an ultra-fast, database-free Go backend.

```text
├── backend/
│   ├── main.go             # Application entrypoint & system signal routing
│   ├── config.go           # Environment settings (Max Uploads, Proxy Headers, directory paths)
│   ├── handlers.go         # API controllers: /api/upload, /api/stat, /api/download with UUID regex
│   ├── storage.go          # Atomic file claiming, tmp buffering, promotion, and linking logic
│   ├── rate_limit.go       # Token-bucket rate limiter per client IP
│   └── cleanup.go          # Background cleanup daemon for expired file deletion
│
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── crypto.ts   # Client-side AES-256-GCM chunking, AAD binding, and Base64URL parsing
│   │   │   ├── api.ts      # Client HTTP API wrapper
│   │   │   └── format.ts   # Helper utilities for safe file sizing and sanitization
│   │   ├── routes/
│   │   │   ├── +layout.svelte # Layout shell, responsive header, and reactive light/dark theme switch
│   │   │   ├── +page.svelte   # Modern dashboard, interactive dropzone, and clipboard hooks
│   │   │   └── d/[fileId]/+page.svelte # Recipient download board & premium expired/gone visual handlers
│   │   ├── app.html        # Primary HTML body incorporating Google Fonts and non-flash theme script
│   │   ├── app.css         # Main stylesheet (Glassmorphism layout, animations, scrollbars, responsive queries)
│   │   └── service-worker.ts # PWA SW caching policy excluding API files
│   └── static/
│       └── manifest.webmanifest # PWA configuration (custom startup layouts, adaptive maskable icons)
│
└── deploy/
    ├── Caddyfile           # Reverse-proxy, security headers, and domain parameters
    ├── install-server.sh   # Automated VPS preparation (environment paths, systemd configuration)
    └── deploy.sh           # Automated client workstation push (builds frontend, compiles Go binary, syncs folders, restarts services)
```

---

## Local Development

### Backend
```bash
cd backend
go test ./...
MALAF_ADDR=127.0.0.1:8081 \
MALAF_FILES_DIR="$PWD/.data/files" \
MALAF_CLAIMED_DIR="$PWD/.data/claimed" \
MALAF_UPLOADS_PER_HOUR=1000 \
go run .
```

### Frontend
```bash
cd frontend
npm ci
npm run check
npm run build
npm run dev -- --host 127.0.0.1 --port 4173
```

---

## Deployment

### Host VPS Setup (Ubuntu LTS)
SSH into your server as root and initialize:
```bash
sudo ./deploy/install-server.sh
```

### Workstation Push (via Git Bash / WSL)
Specify the target IP address and trigger the push:
```bash
export MALAF_DEPLOY_HOST=root@YOUR_SERVER_IP
./deploy/deploy.sh
```
*(Compiles the static frontend, cross-compiles the Go binary for Linux AMD64, pushes files, and restarts services securely).*
