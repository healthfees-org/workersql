# Developer Setup Guide

## Overview

This guide provides comprehensive setup instructions for the WorkerSQL
development environment - a MySQL-compatible edge database platform built on
Cloudflare Workers.

## Prerequisites

### Required Software

- **Node.js**: v18.0.0 or higher ([Download](https://nodejs.org/))
- **npm**: v8.0.0 or higher (comes with Node.js)
- **Git**: Latest version ([Download](https://git-scm.com/))
- **Python**: v3.8+ (for security scanning tools)
- **VS Code**: Recommended IDE ([Download](https://code.visualstudio.com/))

### Cloudflare Account Requirements

- Cloudflare account with Workers enabled
- Workers Paid plan (required for Durable Objects)
- API Token with the following permissions:
  - `Cloudflare Workers:Edit`
  - `Account:Read`
  - `Zone:Read`

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/healthfees-org/workersql.git
cd workersql
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Install Python dependencies for security scanning
python -m pip install --user pre-commit bandit
```

### 3. Setup Pre-commit Hooks

```bash
# Install pre-commit hooks
npm run prepare

# Test pre-commit installation
pre-commit run --all-files
```

### 4. Configure Wrangler

```bash
# Install Wrangler CLI globally (if not already installed)
npm install -g wrangler

# Authenticate with Cloudflare
wrangler auth login

# Copy and configure wrangler.toml
cp wrangler.toml.template wrangler.toml
```

### 5. Environment Configuration

#### Development Environment

Create a `.env.local` file:

```bash
# Copy environment template
cp .env.example .env.local

# Edit with your values
ENVIRONMENT=development
LOG_LEVEL=debug
MAX_SHARD_SIZE_GB=1
CACHE_TTL_MS=300000
CACHE_SWR_MS=600000
SHARD_COUNT=4
```

#### Configure Secrets

```bash
# Set JWT secret for authentication
wrangler secret put JWT_SECRET

# Set encryption keys
wrangler secret put ENCRYPTION_KEY_PRIMARY
wrangler secret put ENCRYPTION_KEY_SECONDARY
```

## Development Workflow

### 1. Build the Project

```bash
# TypeScript compilation
npm run build

# Watch mode for development
npm run build -- --watch
```

### 2. Run Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### 3. Local Development

```bash
# Start local development server
npm run dev

# Test local deployment
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token-12345" \
  -d '{"sql": "SELECT 1 as test"}'
```

### 4. Code Quality

```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check

# Run security scans
npm run security:check

# Complete workflow check
npm run workflow:check
```

## IDE Setup

### VS Code Extensions

Install these recommended extensions:

```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-eslint",
    "bradlc.vscode-tailwindcss",
    "ms-python.python",
    "ms-python.bandit"
  ]
}
```

### VS Code Settings

Add to your `.vscode/settings.json`:

```json
{
  "typescript.preferences.strictFunctionTypes": true,
  "typescript.preferences.strictNullChecks": true,
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.workingDirectories": ["src", "tests"]
}
```

## Testing Strategy

### Unit Tests

- Located in `tests/unit/`
- Use Jest with ts-jest transformer
- Mock Cloudflare Workers environment
- Focus on individual service logic

### Integration Tests

- Located in `tests/integration/`
- Use Miniflare for Cloudflare Workers simulation
- Test service interactions
- Validate cache and queue behaviors

### End-to-End Tests

- Located in `tests/e2e/`
- Test complete workflows
- Validate API contracts
- Performance benchmarking

### Browser Tests

- Located in `tests/browser/`
- Use Playwright for browser automation
- Test client SDK functionality
- Cross-browser compatibility

## Deployment

### Development Deployment

```bash
# Deploy to development environment
wrangler deploy --env development

# View deployment logs
wrangler tail
```

### Staging Deployment

```bash
# Deploy to staging environment
wrangler deploy --env staging

# Run smoke tests against staging
npm run test:smoke -- --env=staging
```

### Production Deployment

```bash
# Deploy to production (requires approval)
wrangler deploy --env production

# Monitor production deployment
wrangler tail --env production
```

## Troubleshooting

### Common Issues

#### Build Failures

```bash
# Clear TypeScript cache
npx tsc --build --clean

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

#### Test Failures

```bash
# Update test snapshots
npm test -- --updateSnapshot

# Run tests with verbose output
npm test -- --verbose

# Debug specific test
npm test -- --testNamePattern="test name"
```

#### Wrangler Issues

```bash
# Re-authenticate
wrangler auth logout
wrangler auth login

# Clear Wrangler cache
rm -rf ~/.wrangler/cache
```

#### Pre-commit Hook Failures

```bash
# Update pre-commit hooks
pre-commit autoupdate

# Skip hooks temporarily (emergency only)
git commit --no-verify
```

### Performance Issues

#### Slow Tests

- Use `--testPathPattern` to run specific tests
- Implement test parallelization
- Mock external dependencies

#### Build Performance

- Use `--incremental` flag with TypeScript
- Configure path mapping correctly
- Exclude unnecessary files from compilation

### Security Issues

#### Token Validation Failures

- Verify JWT_SECRET is set correctly
- Check token expiration times
- Validate issuer and audience claims

#### CORS Issues

- Update gateway CORS configuration
- Check request headers and methods
- Validate origin whitelist

## Contributing

### Code Style

- Follow TypeScript strict mode guidelines
- Use ESLint and Prettier configurations
- Write comprehensive JSDoc comments
- Follow security best practices

### Pull Request Process

1. Create feature branch from `main`
2. Implement changes with tests
3. Run `npm run workflow:check`
4. Submit PR with description
5. Address review feedback
6. Merge after approval

### Security Guidelines

- Never commit secrets or credentials
- Use Wrangler secrets for sensitive data
- Follow OWASP security guidelines
- Run security scans before commits

## Support

### Documentation

- [Architecture Decision Records](./architecture/)
- [API Specification](./api-specification.md)
- [Security Guidelines](./security-guidelines.md)
- [Environment Configuration](./environment-configuration.md)

### Community

- GitHub Issues:
  [Report bugs and feature requests](https://github.com/healthfees-org/workersql/issues)
- GitHub Discussions:
  [Community support and questions](https://github.com/healthfees-org/workersql/discussions)
- Security Issues: security@healthfees.org

### Internal Support

- Development Team: dev-team@healthfees.org
- DevOps Team: devops@healthfees.org
- Security Team: security@healthfees.org

---

_Last updated: September 1, 2025_ _Version: 1.0.0_
