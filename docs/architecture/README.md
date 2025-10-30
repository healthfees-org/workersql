# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the WorkerSQL project.
ADRs document important architectural decisions, their context, and rationale.

## ADR Index

| ADR                                               | Title                                         | Status   | Date       |
| ------------------------------------------------- | --------------------------------------------- | -------- | ---------- |
| [ADR-001](./001-cloudflare-workers-platform.md)   | Cloudflare Workers Platform Selection         | Accepted | 2025-09-01 |
| [ADR-002](./002-durable-objects-storage.md)       | Durable Objects for Authoritative Storage     | Accepted | 2025-09-01 |
| [ADR-003](./003-cache-aside-pattern.md)           | Cache-Aside Pattern with KV                   | Accepted | 2025-09-01 |
| [ADR-004](./004-typescript-strict-mode.md)        | TypeScript Strict Mode Configuration          | Accepted | 2025-09-01 |
| [ADR-005](./005-jest-vitest-testing.md)           | Jest and Vitest Testing Framework Integration | Accepted | 2025-09-01 |
| [ADR-006](./006-routing-sharding-system.md)       | Routing and Sharding System Architecture      | Accepted | 2025-09-02 |
| [ADR-007](./007-gateway-worker-implementation.md) | Gateway Worker Implementation Architecture    | Accepted | 2025-09-02 |
| [ADR-008](./008-sql-compatibility-layer.md)       | SQL Compatibility Layer                       | Accepted | 2025-09-02 |
| [ADR-009](./009-connection-management.md)         | Connection Management                         | Accepted | 2025-09-02 |
| [ADR-010](./010-sdk-integration.md)               | SDK Integration                               | Accepted | 2025-09-02 |
| [ADR-011](./011-shard-management.md)              | Shard Management                              | Accepted | 2025-09-02 |
| [ADR-012](./012-security-enhancements.md)         | Security Enhancements                         | Accepted | 2025-09-02 |
| [ADR-017](./017-geospatial.md)                    | Geospatial and GeoJSON Support                | Accepted | 2025-01-07 |
| [ADR-018](./018-go-sdk.md)                        | Go SDK Implementation                         | Accepted | 2025-10-14 |

## ADR Template

When creating new ADRs, use the following template:

```markdown
# ADR-XXX: [Title]

## Status

[Proposed | Accepted | Deprecated | Superseded]

## Date

YYYY-MM-DD

## Context

[Describe the forces at play, including technological, political, social, and
project local. This is the story explaining the problem we are trying to solve.]

## Decision

[Describe our response to these forces. This is the actual decision made.]

## Rationale

[Describe why this decision was made. Include alternative options considered and
why they were rejected.]

## Consequences

[Describe the resulting context, after applying the decision. All consequences
should be listed here, not just the "positive" ones.]

## References

[List any references, links, or sources that informed this decision.]
```

## Guidelines

### When to Write an ADR

- Significant architectural or design decisions
- Technology stack choices
- Security architecture decisions
- Performance or scalability trade-offs
- Changes to existing architectural decisions

### ADR Lifecycle

1. **Proposed**: Decision is under consideration
2. **Accepted**: Decision has been made and implemented
3. **Deprecated**: Decision is no longer recommended but may still be in use
4. **Superseded**: Decision has been replaced by a newer ADR

### Best Practices

- Keep ADRs concise but comprehensive
- Focus on the decision, not implementation details
- Include the context that led to the decision
- Document alternatives considered
- Update status as decisions evolve
- Link related ADRs when appropriate
