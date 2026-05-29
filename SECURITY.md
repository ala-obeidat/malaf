# Security Policy

## Supported Threat Model

Malaf protects file contents by encrypting in the browser before upload. The backend stores opaque MALAFv1 ciphertext, never receives the decryption key, and deletes stored ciphertext on the first download attempt or expiry.

The design intentionally avoids accounts, a database, plaintext filenames, plaintext MIME types, download records, persistent IP storage, analytics, third-party scripts, and application access logs.

## Important Limitations

- Web crypto is only as trustworthy as the JavaScript delivered to the browser.
- A compromised server or deployment pipeline can attack future users by serving malicious code.
- Anyone with the full URL has the decryption key.
- Cloudflare proxied mode exposes request metadata to Cloudflare.
- Hetzner, ISPs, browsers, extensions, operating systems, and endpoints can still observe or leak metadata.
- Malaf cannot scan encrypted uploads for malware or illegal content.

## Reporting Issues

Report vulnerabilities privately to the repository owner or deployment operator. Do not include plaintext user files, full share links, decryption keys, raw IP addresses, or other sensitive metadata in a report.

Useful reports include:

- A concise description of the issue.
- Steps to reproduce against a local deployment.
- Impact and affected component.
- Suggested fix, if known.

## Operational Rules

- Do not enable backups for `/var/lib/malaf`.
- Keep `/var/lib/malaf/files` and `/var/lib/malaf/claimed` on the same filesystem.
- Keep Caddy access logs discarded.
- Do not add third-party analytics, trackers, fonts, CDN scripts, or JavaScript rewriting.
- Prefer DNS Only Cloudflare mode when privacy is the priority.
