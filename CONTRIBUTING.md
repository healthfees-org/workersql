# Contributing to WorkerSQL

Thank you for your interest in contributing to WorkerSQL! We welcome
contributions from the community and are excited to see what you'll build with
us.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Process](#development-process)
- [Test Coverage Requirements](#test-coverage-requirements)
- [Code Quality Standards](#code-quality-standards)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)
- [Security](#security)
- [Community](#community)

## Code of Conduct

This project and everyone participating in it is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to
uphold this code. Please report unacceptable behavior to
[conduct@healthfees.org](mailto:conduct@healthfees.org).

## Getting Started

### Prerequisites

Before you begin, ensure you have:

- Node.js 18+ installed
- Git configured with your GitHub account
- A Cloudflare account (for full development)
- Read our [Developer Setup Guide](docs/developer-setup-guide.md)

### Setting Up Your Development Environment

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/workersql.git
   cd workersql
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/healthfees-org/workersql.git
   ```
4. **Install dependencies**:
   ```bash
   npm install
   npm run prepare  # Install pre-commit hooks
   ```
5. **Set up your development environment**:
   ```bash
   cp wrangler.toml.template wrangler.toml
   # Follow the setup guide to configure Cloudflare resources
   ```

## Development Process

### Branch Naming

Use descriptive branch names that indicate the type of change:

- `feature/add-websocket-support`
- `fix/auth-token-validation`
- `docs/update-api-specification`
- `test/improve-coverage-auth-service`
- `refactor/optimize-query-parser`

### Commit Message Format

We follow the [Conventional Commits](https://www.conventionalcommits.org/)
specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types:**

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

**Examples:**

```
feat(auth): add JWT token refresh endpoint

Add support for refreshing JWT tokens without requiring
full re-authentication. Includes rate limiting and
security validations.

Closes #123
```

```
test(services): improve AuthService test coverage to 100%

- Add tests for token expiration edge cases
- Test error handling for invalid signatures
- Add integration tests for RBAC permissions

Coverage: AuthService 87% → 100%
```

## Test Coverage Requirements

**⚠️ CRITICAL: We maintain a strict 90%+ test coverage requirement for all
code.**

### Coverage Expectations

- **Overall project coverage**: Minimum 90%
- **New features**: Must have 100% test coverage
- **Bug fixes**: Must include regression tests
- **Refactoring**: Must maintain or improve existing coverage

### Types of Tests Required

#### 1. Unit Tests (`tests/unit/`)

- **Purpose**: Test individual functions and classes in isolation
- **Coverage Target**: 100% for new code
- **Requirements**:
  - Test all public methods
  - Test error conditions and edge cases
  - Mock external dependencies
  - Use descriptive test names

```typescript
// ✅ Good unit test example
describe('AuthService', () => {
  describe('validateToken', () => {
    it('should reject expired tokens', async () => {
      const expiredToken = generateToken({ exp: Date.now() / 1000 - 3600 });

      await expect(authService.validateToken(expiredToken)).rejects.toThrow(
        'Token expired'
      );
    });

    it('should accept valid tokens within expiry window', async () => {
      const validToken = generateToken({ exp: Date.now() / 1000 + 3600 });

      const result = await authService.validateToken(validToken);

      expect(result.tenantId).toBeDefined();
      expect(result.permissions).toEqual(expect.any(Array));
    });
  });
});
```

#### 2. Integration Tests (`tests/integration/`)

- **Purpose**: Test service interactions and API endpoints
- **Coverage Target**: 85%+ for integration scenarios
- **Requirements**:
  - Test realistic data flows
  - Use Miniflare for Cloudflare Workers simulation
  - Test cache and queue interactions

```typescript
// ✅ Good integration test example
describe('Query Execution Integration', () => {
  it('should cache query results and serve from cache on repeat requests', async () => {
    const query = { sql: 'SELECT * FROM users LIMIT 10', params: [] };

    // First request - should miss cache
    const response1 = await request(app)
      .post('/v1/query')
      .send(query)
      .expect(200);

    expect(response1.body.metadata.fromCache).toBe(false);

    // Second request - should hit cache
    const response2 = await request(app)
      .post('/v1/query')
      .send(query)
      .expect(200);

    expect(response2.body.metadata.fromCache).toBe(true);
    expect(response2.body.data).toEqual(response1.body.data);
  });
});
```

#### 3. End-to-End Tests (`tests/e2e/`)

- **Purpose**: Test complete user workflows
- **Coverage Target**: Cover all major user journeys
- **Requirements**:
  - Test against deployed environments
  - Validate API contracts
  - Include performance benchmarks

#### 4. Security Tests (`tests/security/`)

- **Purpose**: Validate security controls and prevent vulnerabilities
- **Coverage Target**: 100% for security-critical paths
- **Requirements**:
  - Test authentication and authorization
  - Validate input sanitization
  - Test rate limiting and DDoS protection

```typescript
// ✅ Good security test example
describe('SQL Injection Protection', () => {
  it('should prevent SQL injection in query parameters', async () => {
    const maliciousInput = "'; DROP TABLE users; --";

    const response = await request(app)
      .post('/v1/query')
      .send({
        sql: 'SELECT * FROM users WHERE name = ?',
        params: [maliciousInput],
      })
      .expect(200);

    // Should safely handle the malicious input as a parameter
    expect(response.body.success).toBe(true);
    // Verify no tables were dropped (would require database inspection)
  });
});
```

### Running Tests and Coverage

```bash
# Run all tests with coverage
npm run test:coverage

# Run specific test types
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:security

# Watch mode for development
npm run test:watch

# Generate coverage report
npm run test:coverage
open coverage/lcov-report/index.html
```

### Coverage Reporting

- **Local Development**: Coverage reports generated in `coverage/` directory
- **CI/CD**: Coverage reported on every PR
- **Minimum Thresholds**: Enforced in `vitest.config.ts`

```typescript
// vitest.config.ts coverage configuration
coverage: {
  thresholds: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    // Per-file thresholds for critical components
    'src/services/AuthService.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
}
```

## Code Quality Standards

### TypeScript Requirements

- **Strict Mode**: All code must compile with TypeScript strict mode
- **Type Safety**: No `any` types without explicit justification
- **Documentation**: Public APIs must have JSDoc comments

```typescript
// ✅ Good TypeScript example
/**
 * Validates a JWT token and extracts authentication context
 * @param token - The JWT token to validate
 * @returns Promise resolving to authentication context
 * @throws {EdgeSQLError} When token is invalid or expired
 */
async validateToken(token: string): Promise<AuthContext> {
  // Implementation with proper error handling
}
```

### Code Style

We use ESLint and Prettier for consistent code formatting:

```bash
# Check code style
npm run lint
npm run format:check

# Fix code style issues
npm run lint:fix
npm run format

# Run complete quality check
npm run workflow:check
```

### Security Requirements

- **No hardcoded secrets**: Use environment variables or Wrangler secrets
- **Input validation**: Validate all user inputs
- **SQL injection prevention**: Use parameterized queries only
- **Authentication**: All endpoints must validate JWT tokens

## Pull Request Process

### Before Submitting

1. **Sync with upstream**:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run the complete test suite**:

   ```bash
   npm run workflow:check
   ```

3. **Ensure coverage requirements**:

   ```bash
   npm run test:coverage
   # Verify overall coverage is ≥90%
   # Verify new code has 100% coverage
   ```

4. **Update documentation** if needed

### PR Template

When creating a PR, please include:

```markdown
## Description

Brief description of changes and motivation.

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to
      not work as expected)
- [ ] Documentation update

## Testing

- [ ] Unit tests added/updated (100% coverage for new code)
- [ ] Integration tests added/updated
- [ ] Security tests added/updated (if applicable)
- [ ] All tests pass locally
- [ ] Coverage requirements met (≥90% overall, 100% for new code)

## Coverage Report

Before: X% After: Y%

New files/functions coverage: 100%

## Checklist

- [ ] Code follows style guidelines (`npm run lint`)
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or clearly documented)
- [ ] Security considerations addressed
```

### Review Process

1. **Automated Checks**: All CI checks must pass
2. **Code Review**: At least one maintainer approval required
3. **Security Review**: Required for authentication, authorization, or data
   handling changes
4. **Coverage Verification**: PR cannot merge if coverage drops below 90%

## Issue Guidelines

### Bug Reports

When reporting bugs, please include:

- **Description**: Clear description of the issue
- **Reproduction Steps**: Minimal steps to reproduce
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Environment**: OS, Node.js version, browser (if applicable)
- **Additional Context**: Logs, screenshots, error messages

### Feature Requests

For new features, please include:

- **Use Case**: Why is this feature needed?
- **Proposed Solution**: How should it work?
- **Alternatives**: What alternatives have you considered?
- **Additional Context**: Examples, mockups, references

### Priority Labels

- `P0`: Critical - Security vulnerabilities, data loss, service down
- `P1`: High - Major functionality broken, performance issues
- `P2`: Medium - Minor functionality issues, feature requests
- `P3`: Low - Documentation, minor improvements

## Security

### Reporting Security Vulnerabilities

**Please do not open public GitHub issues for security vulnerabilities.**

Instead, email us at [security@healthfees.org](mailto:security@healthfees.org)
with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 24 hours and provide a timeline for resolution.

### Security Guidelines

- Follow our [Security Guidelines](docs/security-guidelines.md)
- Use `wrangler secret put` for sensitive data
- Never commit secrets, API keys, or credentials
- Validate all inputs and use parameterized queries
- Implement proper authentication and authorization

## Community

### Getting Help

- **Documentation**: Check our [docs/](docs/) directory first
- **GitHub Discussions**:
  [Community Q&A](https://github.com/healthfees-org/workersql/discussions)
- **GitHub Issues**:
  [Bug reports and feature requests](https://github.com/healthfees-org/workersql/issues)

### Communication Channels

- **Development**: [dev-team@healthfees.org](mailto:dev-team@healthfees.org)
- **Security**: [security@healthfees.org](mailto:security@healthfees.org)
- **General**: [workersql@healthfees.org](mailto:workersql@healthfees.org)

### Recognition

Contributors are recognized in:

- `CONTRIBUTORS.md` file
- Release notes for significant contributions
- Annual contributor appreciation posts

## Development Tips

### Test-Driven Development (TDD)

We encourage TDD for new features:

1. **Write failing test** that describes the desired behavior
2. **Implement minimum code** to make the test pass
3. **Refactor** while keeping tests green
4. **Repeat** for each new requirement

### Coverage-Driven Development

For existing code improvements:

1. **Identify uncovered lines** using coverage reports
2. **Write tests** for uncovered edge cases
3. **Refactor** code to improve testability
4. **Verify** coverage improvement

### Local Development Workflow

```bash
# Start development server
npm run dev

# Run tests in watch mode (separate terminal)
npm run test:watch

# Check coverage continuously
npm run test:coverage -- --watch

# Quality check before committing
npm run workflow:check
```

---

## Thank You!

Your contributions make WorkerSQL better for everyone. We appreciate your time
and effort in helping us build a world-class edge database platform.

**Happy coding!** 🚀

---

_For questions about contributing, reach out to
[dev-team@healthfees.org](mailto:dev-team@healthfees.org)_
