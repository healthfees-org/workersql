---
applyTo: 'src/app/**'
---

Objective: Implement SPA client served by the gateway root using Workers Static Assets.

Key points:
- Build output goes to src/app/dist. Wrangler serves via [assets] binding (ASSETS).
- Keep gateway APIs under /sql, /admin/*, /metrics, /health; non-API paths fall through to ASSETS.
- Enforce Access/Zero Trust via existing AuthService with cf-access-jwt-assertion header; allow local dev with JWT.
- Monitoring uses /admin/graphql proxy with short TTL in KV.
- Backup UI calls /admin/backup endpoints (stubbed) to schedule R2 backups and export local JSON.

Notes:
- CSP relaxed for HTML only via getHtmlSecurityHeaders(); strict default elsewhere.
- Tests for app live under tests/app and run with `npm run test:app` only.
