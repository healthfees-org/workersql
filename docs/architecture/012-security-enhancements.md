# ADR 012: Security Enhancements for WorkersQL

Date: 2025-10-07 Status: Accepted

## Context

WorkersQL needed a production-grade security posture across authentication,
auditability, network controls, and compliance insights. We operate on
Cloudflare Workers, Durable Objects, KV, Queues, D1, and Analytics Engine.
Security must be enforced at the edge, with observability for review and
retention of audit trails.

Key constraints and goals:

- Zero-trust friendly authentication compatible with Cloudflare Access
- Tamper-resistant audit logging with short-term Analytics Engine and long-term
  R2
- Tight network controls (HTTPS, IP/country allow/block) with safe defaults
- Compliance visibility via queryable metrics (Analytics Engine SQL API)
- Minimal perf overhead; align with platform best practices

## Decision

We implemented a layered security architecture:

1. Authentication and RBAC

- Gateway validates Cloudflare Access JWT (audience, issuer, exp) via
  `AuthService`.
- Admin routes require `admin` permission; tenant context extracted for DB ops.
- Server-side token injection for Admin GraphQL proxy, never exposed to clients.

2. Audit logging pipeline

- Primary sink: Analytics Engine dataset binding `AUDIT_LOGS` using
  `writeDataPoint`.
- Fallback path: Analytics Engine SQL API via `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_API_TOKEN`.
- Buffered export to R2 bucket `AUDIT_LOGS_BUCKET` with optional AES-GCM
  encryption (feature-flagged via `DATA_ENCRYPTION_ENABLED`, key via
  `DATA_ENCRYPTION_KEY`).
- Time-based retention enforced with `AUDIT_RETENTION_DAYS` and lifecycle rules.

3. Network security controls

- Enforce HTTPS (HSTS) and add security headers (X-Content-Type-Options,
  Frame-Options, Referrer-Policy, CSP baseline).
- Country/IP allow/block lists sourced from env: `ALLOW_COUNTRIES`,
  `BLOCK_COUNTRIES`, `ALLOW_IPS`, `BLOCK_IPS` using `request.cf.country` and
  `CF-Connecting-IP`.

4. Compliance reporting

- `ComplianceService` aggregates audit trails via Analytics Engine SQL API to
  produce per-tenant summaries over time windows for review and reporting.

5. Configuration and bindings

- Wrangler bindings: `AUDIT_LOGS` (Analytics Engine), `AUDIT_LOGS_BUCKET` (R2),
  `APP_CACHE`, Queues, DO, and D1 as before.
- Environment: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCESS_AUD`, network gates, retention days, and encryption flags.

## Alternatives Considered

- KV-based audit logs: rejected due to scale, queryability, and cost vs AE.
- Only R2 for logs: rejected; lacks near-real-time analytics and aggregation.
- Client-supplied API tokens: rejected; we use server-side secrets and proxy to
  avoid exposure.

## Consequences

- Pros:
  - Stronger auth posture; admin functions gated by RBAC.
  - Queryable, durable auditing with flexible retention and optional encryption.
  - Clear network policy with deterministic deny-by-default toggles.
  - Compliance insights without coupling application logic to reporting storage.
- Cons:
  - Additional bindings and secrets to manage.
  - AE SQL API introduces dependency on CF Analytics; requires tokens/limits
    awareness.

## Security Considerations

- Never log or return secret values; redact tokens in error paths.
- Store API tokens as Worker Secrets (via wrangler secrets) and not in KV.
- Prefer short TTL caches for Admin proxy responses to reduce API pressure.
- Encryption is optional but recommended for R2 persistence when storing
  sensitive payloads.

## References

- Cloudflare Analytics Engine:
  https://developers.cloudflare.com/analytics/analytics-engine/
- GraphQL Analytics API:
  https://developers.cloudflare.com/analytics/graphql-api/
- Workers Security headers:
  https://developers.cloudflare.com/workers/examples/security-headers/
- IP Geolocation & headers:
  https://developers.cloudflare.com/network/ip-geolocation/
- Admin proxy guidance: see `docs/security-setup.md`
