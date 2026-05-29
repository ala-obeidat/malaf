# Cloudflare Notes

Malaf has two supported Cloudflare modes. Pick one deliberately.

## Privacy-first mode

Set the `malaf.alaobeidat.com` DNS record to DNS Only, also called grey cloud.

In this mode, browsers connect directly to the Hetzner VPS and Caddy terminates TLS at the origin. This exposes less visitor metadata to Cloudflare, but the origin IP is public and Cloudflare does not absorb direct DDoS traffic.

## Protection-first mode

Set the DNS record to Proxied, also called orange cloud.

In this mode, Cloudflare terminates TLS at the edge and proxies to Hetzner. This improves DDoS resistance and makes Cloudflare WAF/rate-limit controls available, but Cloudflare can observe visitor IP addresses, request paths, user agents, timing, and encrypted file sizes. Do not describe this mode as fully anonymous.

Required settings for proxied mode:

- Disable caching for `/api/*`.
- Disable Rocket Loader.
- Disable Auto Minify for JavaScript.
- Disable Email Obfuscation and any feature that rewrites HTML or JavaScript.
- Keep WebSockets off unless a future version explicitly needs them.
- Keep analytics and third-party scripts out of the application.

The URL fragment still does not travel in HTTP requests, so Cloudflare should not receive the decryption key unless a user copies it into a non-fragment field or another tool leaks the full URL.
