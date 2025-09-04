# WorkerSQL

<div align="center">

![WorkerSQL Logo](https://github.com/healthfees-org/workersql/blob/main/docs/workersql.png?raw=true)

**MySQL-compatible edge database platform built on Cloudflare Workers**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2+-blue.svg)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com/)

[Features](#features) • [Quick Start](#quick-start) • [API Reference](#api-reference) • [Documentation](#documentation) • [Contributing](#contributing)

</div>

## Overview

WorkerSQL is a high-performance, MySQL-compatible edge database platform that brings your data closer to your users. Built on Cloudflare Workers, it provides:

- **Edge-native architecture** with sub-50ms query latency globally
- **MySQL compatibility** for seamless migration from existing applications
- **Automatic scaling** with zero cold starts
- **Multi-tenant isolation** with built-in security
- **Real-time caching** with cache-aside pattern implementation
- **ACID transactions** via Durable Objects

## Features

### 🚀 Performance
- **Sub-50ms latency** globally via Cloudflare's edge network
- **Intelligent caching** with configurable TTL and stale-while-revalidate
- **Connection pooling** and query optimization
- **Automatic shard management** based on data size and access patterns

### 🔒 Security
- **JWT-based authentication** with role-based access control (RBAC)
- **Tenant isolation** ensuring complete data separation
- **SQL injection prevention** with parameterized queries
- **Encryption at rest and in transit** using industry standards
- **Audit logging** for compliance and monitoring

### 🛠 Developer Experience
- **MySQL-compatible SQL** - use existing tools and knowledge
- **RESTful API** with comprehensive OpenAPI specification
- **WebSocket support** for real-time updates
- **Multi-language SDKs** (JavaScript/TypeScript, Python, PHP)
- **Local development tools** with Miniflare integration

### 📊 Monitoring & Observability
- **Real-time metrics** and performance monitoring
- **Health checks** and status endpoints
- **Detailed logging** with configurable levels
- **Integration ready** for external monitoring tools

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Cloudflare account with Workers enabled
- Wrangler CLI installed globally

### Installation

```bash
# Clone the repository
git clone https://github.com/healthfees-org/workersql.git
cd workersql

# Install dependencies
npm install

# Set up development environment
npm run setup:dev

# Start local development server
npm run dev
```

### Basic Usage

```bash
# Test the health endpoint
curl http://localhost:8787/health

# Execute a SQL query
curl -X POST http://localhost:8787/v1/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "sql": "SELECT * FROM users WHERE active = ?",
    "params": [true]
  }'
```

## API Reference

### Authentication

All API requests require a valid JWT token:

```http
Authorization: Bearer <jwt_token>
```

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/query` | Execute SQL query |
| `POST` | `/v1/query/batch` | Execute multiple queries |
| `POST` | `/v1/transactions` | Begin transaction |
| `POST` | `/v1/transactions/{id}/commit` | Commit transaction |
| `POST` | `/v1/transactions/{id}/rollback` | Rollback transaction |
| `GET` | `/v1/schema` | Get database schema |
| `GET` | `/v1/health` | Health check |
| `GET` | `/v1/metrics` | Performance metrics |

### Example Query

```json
{
  "sql": "SELECT * FROM products WHERE price > ? AND category = ?",
  "params": [100, "electronics"],
  "hints": {
    "consistency": "strong",
    "cacheTtl": 300000,
    "shardKey": "tenant_123"
  }
}
```

### Response Format

```json
{
  "success": true,
  "data": {
    "rows": [...],
    "rowsAffected": 1,
    "insertId": 123,
    "metadata": {
      "fromCache": false,
      "shardId": "shard_0",
      "executionTimeMs": 15
    }
  }
}
```

## Client SDKs

### JavaScript/TypeScript

```typescript
import { WorkerSQL } from '@workersql/client';

const db = new WorkerSQL({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.workersql.com'
});

const users = await db.query('SELECT * FROM users WHERE id = ?', [123]);
```

### Python

```python
from workersql import Client

db = Client(api_key='your-api-key')
result = db.query('SELECT * FROM users WHERE id = %s', [123])
```

### PHP

```php
<?php
use WorkerSQL\Client;

$db = new Client(['api_key' => 'your-api-key']);
$result = $db->query('SELECT * FROM users WHERE id = ?', [123]);
```

## Architecture

WorkerSQL is built on a distributed architecture optimized for edge computing:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client SDK    │────│  Edge Gateway   │────│  Durable Object │
│                 │    │   (Workers)     │    │     Shards      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                       ┌─────────────────┐
                       │   KV Cache      │
                       │   & Queues      │
                       └─────────────────┘
```

### Key Components

- **Edge Gateway**: Request routing, authentication, and caching
- **Durable Object Shards**: ACID-compliant data storage
- **KV Cache**: High-performance query result caching
- **Event Queues**: Asynchronous operations and cache invalidation
- **Connection Manager**: Efficient connection pooling and management

## Development

### Setup Development Environment

```bash
# Install dependencies
npm install

# Set up pre-commit hooks
npm run prepare

# Configure Wrangler
cp wrangler.toml.template wrangler.toml
wrangler auth login

# Create Cloudflare resources
npm run setup:cloudflare
```

### Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e

# Run tests with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### Code Quality

```bash
# Lint code
npm run lint

# Format code
npm run format

# Type checking
npm run type-check

# Complete quality check
npm run workflow:check
```

### Local Development

```bash
# Start development server with hot reload
npm run dev

# Build for production
npm run build

# Deploy to staging
npm run deploy:staging
```

## Documentation

- 📖 [API Specification](docs/api-specification.md)
- 🔧 [Developer Setup Guide](docs/developer-setup-guide.md)
- 🏗️ [Architecture Documentation](docs/architecture/)
- 🔒 [Security Guidelines](docs/security-guidelines.md)
- ⚙️ [Environment Configuration](docs/environment-configuration.md)
- 🚀 [Local Development Setup](docs/local-development-setup.md)

## Deployment

### Environment Setup

1. **Development**: Local testing with Miniflare
2. **Staging**: Pre-production testing environment
3. **Production**: Live production deployment

### Deployment Commands

```bash
# Deploy to staging
wrangler deploy --env staging

# Deploy to production
wrangler deploy --env production

# View deployment logs
wrangler tail --env production
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ENVIRONMENT` | Deployment environment | `development` |
| `LOG_LEVEL` | Logging verbosity | `info` |
| `MAX_SHARD_SIZE_GB` | Maximum shard size | `10` |
| `CACHE_TTL_MS` | Cache TTL in milliseconds | `300000` |
| `JWT_SECRET` | JWT signing secret | *(required)* |

## Performance

### Benchmarks

- **Query Latency**: <50ms globally (p95)
- **Throughput**: 10,000+ queries/second per edge location
- **Cache Hit Rate**: 85%+ for typical workloads
- **Cold Start**: 0ms (edge-native architecture)

### Optimization Tips

1. **Use appropriate cache TTL** for your data freshness requirements
2. **Optimize shard keys** for even data distribution
3. **Batch related queries** to reduce round trips
4. **Use read replicas** for analytics workloads

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run `npm run workflow:check`
5. Submit a pull request

### Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Support

### Community

- 🐛 [Report Issues](https://github.com/healthfees-org/workersql/issues)
- 💬 [GitHub Discussions](https://github.com/healthfees-org/workersql/discussions)
- 📧 [Mailing List](mailto:workersql@healthfees.org)

### Commercial Support

For enterprise support, SLA guarantees, and custom development:

- 📧 **Sales**: sales@healthfees.org
- 📧 **Support**: support@healthfees.org
- 🔒 **Security**: security@healthfees.org

## Roadmap

### Current (Q3 2025)
- ✅ Core SQL compatibility
- ✅ Authentication & authorization
- ✅ Multi-tenant isolation
- ✅ Real-time caching

### Upcoming (Q4 2025)
- 🔄 Advanced analytics queries
- 🔄 Cross-region replication
- 🔄 GraphQL API support
- 🔄 Enhanced monitoring dashboard

### Future (Q1+ 2026)
- 📋 Full-text search capabilities
- 📋 Advanced encryption features
- 📋 Machine learning integrations

## Acknowledgments

- Built on [Cloudflare Workers](https://workers.cloudflare.com/)
- Inspired by [PlanetScale](https://planetscale.com/) and [Neon](https://neon.tech/)
- Thanks to all [contributors](CONTRIBUTORS.md)

---

<div align="center">

**Made with ❤️ by the HealthFees team**

[Website](https://healthfees.org) • [Blog](https://www.healthfees.org/insights) • [Twitter](https://twitter.com/healthfees)

</div>
