# ADR-005: Jest and Vitest Testing Framework Integration

## Status

Accepted

## Date

2025-09-01

## Context

WorkerSQL requires comprehensive testing capabilities for:

- Unit testing of service components
- Integration testing of Worker endpoints
- Performance testing of database operations
- Cloudflare Workers environment simulation
- Code coverage tracking and reporting

Testing framework considerations:

1. **Jest Only**: Traditional Node.js testing with extensive ecosystem
2. **Vitest Only**: Fast, Vite-native testing with ES modules support
3. **Dual Framework**: Jest for comprehensive testing, Vitest for development
   speed
4. **Custom Framework**: Building our own testing utilities

## Decision

We implemented **Dual Framework Testing** using both Jest and Vitest with
specialized configurations for different testing scenarios.

## Rationale

### Framework Allocation:

**Jest Configuration (jest.config.cjs):**

- Comprehensive testing with full ecosystem support
- Cloudflare Workers simulation via Miniflare
- Code coverage reporting with c8/Istanbul
- Complex integration and E2E testing
- CI/CD pipeline testing

**Vitest Configuration (vitest.config.ts):**

- Fast development iteration with HMR
- ES modules native support
- Simple unit tests and TDD workflows
- Watch mode for continuous testing
- Development-time feedback

### Technical Implementation:

**Jest Setup (jest.config.cjs):**

```javascript
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapping: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'miniflare',
  testEnvironmentOptions: {
    modules: true,
    scriptPath: './src/gateway.ts',
    bindings: { NODE_ENV: 'test' },
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!sdk/**/*'],
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.spec.ts'],
};
```

**Vitest Setup (vitest.config.ts):**

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['sdk/**/*', 'tests/**/*'],
    },
    include: ['tests/**/*.vitest.test.ts'],
    exclude: ['tests/e2e/**', 'tests/integration/**'],
  },
});
```

### Benefits of Dual Framework Approach:

**Development Efficiency:**

- Vitest provides instant feedback during development
- Jest ensures comprehensive testing for CI/CD
- Different tools for different testing phases
- Optimal performance for each use case

**Cloudflare Workers Support:**

- Jest + Miniflare simulates Workers runtime accurately
- Vitest handles pure TypeScript unit tests efficiently
- Environment isolation prevents conflicts
- Proper binding and context simulation

**Code Coverage:**

- Comprehensive coverage reporting from Jest
- Fast coverage feedback from Vitest
- Multiple coverage providers for validation
- Detailed HTML reports for analysis

## Consequences

### Positive:

- **Fast Development**: Vitest provides sub-second test execution
- **Comprehensive Testing**: Jest handles complex scenarios
- **Workers Simulation**: Miniflare integration for accurate testing
- **Flexible Coverage**: Multiple coverage strategies available
- **IDE Integration**: Both frameworks support excellent IDE integration
- **Community Support**: Access to both ecosystems

### Negative:

- **Configuration Complexity**: Managing two testing frameworks
- **Learning Curve**: Developers need to understand both tools
- **Potential Conflicts**: Configuration and dependency management
- **Test Duplication**: Risk of writing tests in wrong framework

### Framework-Specific Patterns:

**Jest Integration Tests:**

```typescript
// tests/integration/gateway.test.ts
import { SELF } from 'cloudflare:test';

describe('Gateway Integration', () => {
  test('should handle SQL query request', async () => {
    const response = await SELF.fetch('http://localhost/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: 'SELECT 1 as test',
        parameters: [],
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result).toEqual([{ test: 1 }]);
  });
});
```

**Vitest Unit Tests:**

```typescript
// tests/unit/CacheService.vitest.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CacheService } from '../../src/services/CacheService';

describe('CacheService', () => {
  it('should set and get cache values', async () => {
    const mockKV = {
      get: vi.fn().mockResolvedValue('{"data":"test"}'),
      put: vi.fn().mockResolvedValue(undefined),
    };

    const cache = new CacheService(mockKV as any);
    await cache.set('key', { data: 'test' });
    const result = await cache.get('key');

    expect(result).toEqual({ data: 'test' });
  });
});
```

### SDK Exclusion Strategy:

Both frameworks exclude SDK from testing and coverage:

```javascript
// Jest
collectCoverageFrom: [
  'src/**/*.ts',
  '!sdk/**/*'
],

// Vitest
coverage: {
  exclude: ['sdk/**/*']
}
```

### Test Organization:

```
tests/
├── unit/           # Fast Vitest unit tests
├── integration/    # Jest integration tests with Miniflare
├── services/       # Service-specific tests (both frameworks)
├── e2e/           # End-to-end tests (Jest + Playwright)
└── fixtures/      # Shared test data and mocks
```

### Performance Benchmarks:

**Vitest Performance:**

- Unit tests: ~52 tests in 3-5 seconds
- Watch mode: ~100ms for changed files
- Coverage generation: ~1 second additional

**Jest Performance:**

- Integration tests: ~15 tests in 8-12 seconds
- Full coverage: ~5 seconds additional
- Miniflare startup: ~2 seconds overhead

### CI/CD Integration:

**GitHub Actions Workflow:**

```yaml
- name: Run Vitest Unit Tests
  run: npm run test:unit

- name: Run Jest Integration Tests
  run: npm run test:integration

- name: Generate Coverage Report
  run: npm run test:coverage
```

**NPM Scripts:**

```json
{
  "test": "npm run test:unit && npm run test:integration",
  "test:unit": "vitest run",
  "test:integration": "jest",
  "test:watch": "vitest",
  "test:coverage": "jest --coverage"
}
```

### Troubleshooting Common Issues:

**ESM Import Errors:**

- Jest: Use `extensionsToTreatAsEsm` and `moduleNameMapping`
- Vitest: Native ES modules support, no configuration needed

**Miniflare Module Resolution:**

- Specify `scriptPath` pointing to main Worker script
- Use `modules: true` for ES modules support
- Set proper `testEnvironmentOptions`

**TypeScript Configuration:**

- Both frameworks use same `tsconfig.json`
- Jest requires `ts-jest` preset for ESM
- Vitest handles TypeScript natively

## References

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Vitest Documentation](https://vitest.dev/guide/)
- [Miniflare Testing Guide](https://miniflare.dev/testing)
- [Cloudflare Workers Testing](https://developers.cloudflare.com/workers/testing/)
- [TypeScript Jest Configuration](https://jestjs.io/docs/getting-started#using-typescript)
