# ADR 015: SPA Client for WorkerSQL

Status: Proposed

## Context
We need a lightweight, modern GUI (phpMyAdmin-like) for basic database operations, monitoring, logs, security, migrations, and backup/restore, served directly from the gateway.

## Decision
- Implement a Svelte-based SPA under `src/app`, built with Vite, Tailwind. Output in `src/app/dist`.
- Use Workers Static Assets via Wrangler `[assets]` with `binding = "ASSETS"` and directory pointing to the `dist` folder.
- Gateway serves API endpoints and forwards non-API paths to `env.ASSETS.fetch(request)`. Root `/` opens the SPA.
- Authentication relies on Cloudflare Access SSO (cf-access-jwt-assertion) validated by `AuthService`; fallback to dev JWT for local testing.
- Monitoring dashboard aggregates `/metrics` and Cloudflare GraphQL via `/admin/graphql` proxy.
- Backup features: schedule R2 backups (admin-only) and local export download. R2 scheduling is stubbed pending full implementation.

## Consequences
- CSP must be relaxed for HTML responses while staying strict for API responses.
- A separate test config `vitest.app.config.ts` isolates app tests from existing suites.

## Implementation Notes
- New helper `getHtmlSecurityHeaders()` in gateway.
- New admin endpoints `/admin/backup/r2` and `/admin/backup/export` with admin guard.
