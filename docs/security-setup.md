## Security setup and operations

This page summarizes the security-related configuration for WorkersQL: bindings,
environment variables, and the Admin GraphQL proxy usage, with references to
Cloudflare docs.

### Bindings

- Analytics Engine dataset (audit logs)
  - Wrangler: add a dataset binding. Dataset is auto-created on first write.
  - Example (wrangler.toml):

    [[analytics_engine_datasets]] binding = "AUDIT_LOGS" dataset = "audit_logs"

  - Docs: Analytics Engine get started (binding, writeDataPoint, limits)
    - https://developers.cloudflare.com/analytics/analytics-engine/get-started
    - https://developers.cloudflare.com/analytics/analytics-engine/limits

- R2 bucket (long-term audit persistence)
  - Wrangler:

    [[r2_buckets]] binding = "AUDIT_LOGS_BUCKET" bucket_name =
    "workersql-audit-<env>"

  - Configure retention via R2 lifecycle rules in your Cloudflare account
    (recommended) and/or rely on the service cleanupOldLogs() as a safety net.

### Environment variables

Set these in wrangler toml or via dashboard/secrets as appropriate:

- CLOUDFLARE_ACCOUNT_ID: required for SQL API queries.
- CLOUDFLARE_API_TOKEN: API token with Account Analytics Read permission for SQL
  API.
- CLOUDFLARE_ACCESS_AUD: application AUD for validating Cloudflare Access
  tokens.
- ENFORCE_HTTPS: "true" to block non-HTTPS.
- ALLOW_COUNTRIES / BLOCK_COUNTRIES: comma-delimited ISO-3166-1 alpha-2 country
  codes.
- ALLOW_IPS / BLOCK_IPS: comma-delimited IPs for allow/block lists.
- AUDIT_RETENTION_DAYS: numeric retention for cleanup in R2.
- DATA_ENCRYPTION_ENABLED: "true" to encrypt R2 audit buffers using AES-GCM.
- DATA_ENCRYPTION_KEY: base64 key material for AES-GCM (optional; otherwise
  derived).

### Network security controls

- The gateway enforces HTTPS (when ENFORCE_HTTPS=true), country/IP allow/block
  gates using request.cf.country and visitor IP via
  CF-Connecting-IP/X-Forwarded-For. Relevant Cloudflare docs:
  - Cloudflare HTTP headers reference (CF-Connecting-IP, X-Forwarded-For,
    CF-IPCountry):
    - https://developers.cloudflare.com/fundamentals/reference/http-headers
  - IP Geolocation and country header:
    - https://developers.cloudflare.com/network/ip-geolocation

### Admin GraphQL proxy

- Endpoint: `/admin/graphql`
- Requires a valid Authorization (Cloudflare Access or custom JWT) and an
  `admin` permission in the token.
- Injects CLOUDFLARE_API_TOKEN server-side and applies a 30s KV TTL cache.
- Optional override for GraphQL endpoint via CLOUDFLARE_GRAPHQL_ENDPOINT.

### Audit logging pipeline

- Primary write path uses Analytics Engine dataset binding via
  `env.AUDIT_LOGS.writeDataPoint`. Fallback to SQL API is enabled when binding
  is not available.
- Buffered events are periodically persisted to R2; when
  DATA_ENCRYPTION_ENABLED=true, AES-GCM encrypted buffers are stored with `.enc`
  suffix.
- Use the ComplianceService to generate summary reports using the SQL API
  (requires accountID/token).

### Verification checklist

- [ ] AUDIT_LOGS dataset binding exists in wrangler.toml
- [ ] AUDIT_LOGS_BUCKET R2 binding exists in wrangler.toml
- [ ] CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are set
- [ ] CLOUDFLARE_ACCESS_AUD is configured for Access JWT validation
- [ ] ENFORCE_HTTPS and allow/block lists reflect your policy
- [ ] DATA*ENCRYPTION*\* configured appropriately if encryption desired
