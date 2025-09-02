# ADR-004: TypeScript Strict Mode Configuration

## Status

Accepted

## Date

2025-09-01

## Context

WorkerSQL requires robust type safety and code quality for a production database
system. TypeScript configuration choices significantly impact:

- Runtime error prevention
- Developer productivity
- Code maintainability
- API contract enforcement
- Integration with Cloudflare Workers runtime

Configuration approaches considered:

1. **Loose TypeScript**: Basic type checking, flexible configuration
2. **Standard Strict**: Standard strict mode with common options
3. **Maximum Strict**: All strict options enabled, including experimental
4. **Custom Strict**: Tailored strict configuration for our use case

## Decision

We implemented **Maximum Strict TypeScript configuration** with all strict
options enabled and additional quality checks.

## Rationale

### Configuration Details:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUncheckedIndexedAccess": true
  }
}
```

### Benefits of Maximum Strict Mode:

**Runtime Safety:**

- Null/undefined safety prevents common runtime errors
- Type exhaustiveness checks prevent logic errors
- Strict function typing prevents callback errors
- Property access validation prevents dynamic access errors

**Code Quality:**

- Forces explicit type annotations
- Prevents unused code accumulation
- Ensures all code paths return values
- Validates override relationships

**Database System Requirements:**

- Critical for data integrity operations
- Prevents type coercion bugs in SQL operations
- Ensures proper error handling patterns
- Validates configuration object structures

### Cloudflare Workers Compatibility:

- Isolates runtime provides strict JavaScript environment
- V8 engine benefits from type optimizations
- Minimal runtime overhead from strict checks
- Better dead code elimination

## Consequences

### Positive:

- **Higher Code Quality**: Catches bugs at compile time
- **Better Developer Experience**: IDE provides more accurate suggestions
- **Runtime Performance**: Better V8 optimizations from type information
- **Maintainability**: Easier refactoring with type safety
- **API Contracts**: Ensures interface compliance
- **Documentation**: Types serve as living documentation

### Negative:

- **Learning Curve**: Higher barrier to entry for contributors
- **Development Speed**: More time spent on type annotations initially
- **Migration Effort**: Existing code required extensive updates
- **Third-party Integration**: Some libraries may not have strict typing

### Mitigation Strategies:

**Developer Onboarding:**

- Comprehensive TypeScript guidelines
- Code examples and patterns
- Pair programming for new contributors
- Gradual introduction to advanced features

**Productivity Tools:**

- ESLint integration for additional checks
- Pre-commit hooks for type validation
- IDE configuration recommendations
- Automated code generation where applicable

**Legacy Code Handling:**

- Gradual migration strategy
- Type assertion utilities for edge cases
- Wrapper types for external dependencies
- Incremental strictness adoption

### Implementation Examples:

**Exact Optional Properties:**

```typescript
// Prevents accidental undefined assignment
interface CacheOptions {
  ttlMs?: number;
  swrMs?: number;
}

// ❌ This is now a compile error
const options: CacheOptions = {
  ttlMs: 1000,
  swrMs: undefined, // Error with exactOptionalPropertyTypes
};

// ✅ Correct usage
const options: CacheOptions = {
  ttlMs: 1000,
  // swrMs omitted entirely
};
```

**Strict Index Access:**

```typescript
// Prevents unchecked property access
interface UserMap {
  [userId: string]: User;
}

const users: UserMap = {};
const user = users['123']; // Type: User | undefined

// Must handle undefined case
if (user) {
  console.log(user.name); // Safe access
}
```

**No Unused Parameters:**

```typescript
// Forces explicit parameter usage or underscore prefix
function processData(_unusedParam: string, data: any[]) {
  return data.map((item) => item.value);
}
```

### Tools Integration:

**ESLint Configuration:**

```json
{
  "@typescript-eslint/no-unused-vars": "error",
  "@typescript-eslint/strict-boolean-expressions": "error",
  "@typescript-eslint/prefer-nullish-coalescing": "error",
  "@typescript-eslint/prefer-optional-chain": "error"
}
```

**IDE Settings:**

```json
{
  "typescript.preferences.strictFunctionTypes": true,
  "typescript.preferences.strictNullChecks": true,
  "typescript.suggest.autoImports": true
}
```

## References

- [TypeScript Strict Mode Documentation](https://www.typescriptlang.org/tsconfig#strict)
- [TypeScript Compiler Options](https://www.typescriptlang.org/tsconfig#compilerOptions)
- [Cloudflare Workers TypeScript Guide](https://developers.cloudflare.com/workers/languages/typescript/)
- [ESLint TypeScript Rules](https://typescript-eslint.io/rules/)
- [TypeScript Best Practices](https://google.github.io/styleguide/tsguide.html)
