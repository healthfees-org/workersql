# Security Guidelines

## Overview

This document outlines comprehensive security guidelines for the WorkerSQL
platform, covering authentication, authorization, data protection, and
operational security best practices.

## Security Architecture

### Defense in Depth

WorkerSQL implements multiple layers of security:

1. **Network Security**: HTTPS/TLS encryption, DDoS protection
2. **Authentication**: JWT-based token validation
3. **Authorization**: Role-based access control (RBAC)
4. **Data Security**: Encryption at rest and in transit
5. **Application Security**: Input validation, SQL injection prevention
6. **Infrastructure Security**: Cloudflare's built-in security features

### Security Principles

- **Least Privilege**: Users and services have minimum required permissions
- **Zero Trust**: No implicit trust, validate everything
- **Defense in Depth**: Multiple security layers and controls
- **Fail Secure**: System fails to a secure state when errors occur
- **Security by Design**: Security considerations built into architecture

## Authentication & Authorization

### JWT Token Security

#### Token Generation

```typescript
// Secure token generation
const token = jwt.sign(
  {
    sub: userId,
    tenant_id: tenantId,
    permissions: userPermissions,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
    iss: 'workersql.com',
    aud: 'workersql-api',
  },
  process.env.JWT_SECRET,
  { algorithm: 'RS256' }
);
```

#### Token Validation Requirements

- **Algorithm Verification**: Only RS256 allowed
- **Issuer Validation**: Must match expected issuer
- **Audience Validation**: Must match API audience
- **Expiration Check**: Reject expired tokens
- **Signature Verification**: Cryptographic validation required

#### Security Controls

- **Short Expiration**: Maximum 1-hour token lifetime
- **Secure Storage**: Never store in localStorage, use httpOnly cookies
- **Token Rotation**: Regular key rotation (monthly)
- **Revocation Support**: Maintain token blacklist for compromised tokens

### Role-Based Access Control (RBAC)

#### Permission Model

```typescript
interface Permissions {
  // Data access permissions
  'data:read': boolean;
  'data:write': boolean;
  'data:delete': boolean;

  // Schema management permissions
  'schema:read': boolean;
  'schema:write': boolean;
  'schema:drop': boolean;

  // Administrative permissions
  'admin:users': boolean;
  'admin:monitoring': boolean;
  'admin:cache': boolean;
}
```

#### Role Definitions

```typescript
const ROLES = {
  'read-only': ['data:read', 'schema:read'],
  developer: ['data:read', 'data:write', 'schema:read', 'schema:write'],
  admin: ['*'], // All permissions
  service: ['data:read', 'data:write'], // Service-to-service
};
```

#### Tenant Isolation

- **Strict Boundaries**: No cross-tenant data access
- **Shard Isolation**: Tenant data in dedicated Durable Object instances
- **Query Validation**: All queries validated for tenant scope
- **Audit Logging**: All cross-tenant access attempts logged

## Data Protection

### Encryption Standards

#### Encryption at Rest

- **Algorithm**: AES-256-GCM
- **Key Management**: Cloudflare's key management service
- **Data Types**: All sensitive data fields encrypted
- **Key Rotation**: Automatic monthly rotation

#### Encryption in Transit

- **TLS Version**: TLS 1.3 minimum
- **Cipher Suites**: AEAD ciphers only (AES-GCM, ChaCha20-Poly1305)
- **Certificate Management**: Automated via Cloudflare
- **HSTS**: Strict Transport Security enforced

#### Field-Level Encryption

```typescript
// Sensitive fields encrypted before storage
const encryptedData = {
  id: user.id, // Not encrypted
  email: encrypt(user.email, 'email'), // Encrypted
  name: user.name, // Not encrypted
  ssn: encrypt(user.ssn, 'pii'), // Encrypted
  created_at: user.created_at, // Not encrypted
};
```

### Data Classification

#### Classification Levels

1. **Public**: No protection required
2. **Internal**: Access controls required
3. **Confidential**: Encryption required
4. **Restricted**: Enhanced encryption + access logging

#### Handling Requirements

```typescript
const DATA_CLASSIFICATION = {
  public: {
    encryption: false,
    access_logging: false,
    retention_days: 2555, // 7 years
  },
  internal: {
    encryption: false,
    access_logging: true,
    retention_days: 1095, // 3 years
  },
  confidential: {
    encryption: true,
    access_logging: true,
    retention_days: 365, // 1 year
  },
  restricted: {
    encryption: true,
    enhanced_encryption: true,
    access_logging: true,
    retention_days: 90, // 90 days
  },
};
```

## Input Validation & SQL Injection Prevention

### Parameterized Queries

```typescript
// ✅ SECURE: Using parameterized queries
const result = await db.query(
  'SELECT * FROM users WHERE email = ? AND status = ?',
  [userEmail, 'active']
);

// ❌ INSECURE: String concatenation
const result = await db.query(
  `SELECT * FROM users WHERE email = '${userEmail}'`
);
```

### Input Validation Rules

#### SQL Statement Validation

```typescript
class SQLSecurityService {
  validateSQL(sql: string): ValidationResult {
    // 1. Check for dangerous keywords
    const dangerousKeywords = ['DROP', 'TRUNCATE', 'DELETE', 'UPDATE'];

    // 2. Validate parameter placeholders
    const parameterCount = (sql.match(/\?/g) || []).length;

    // 3. Check for SQL injection patterns
    const injectionPatterns = [
      /union\s+select/i,
      /'\s*or\s*'1'\s*=\s*'1/i,
      /;\s*drop\s+table/i,
    ];

    return { isValid: true, errors: [] };
  }
}
```

#### Data Type Validation

```typescript
// Input sanitization and validation
const validateInput = (input: unknown, type: string): boolean => {
  switch (type) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input));
    case 'integer':
      return Number.isInteger(Number(input));
    case 'uuid':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(input)
      );
    default:
      return true;
  }
};
```

### Query Execution Security

#### Statement Allow-listing

```typescript
const ALLOWED_OPERATIONS = {
  'read-only': ['SELECT'],
  developer: ['SELECT', 'INSERT', 'UPDATE'],
  admin: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP'],
};
```

#### Resource Limits

```typescript
const SECURITY_LIMITS = {
  maxQueryLength: 10000,
  maxParameterCount: 100,
  maxResultRows: 10000,
  maxExecutionTimeMs: 30000,
  maxConcurrentQueries: 10,
};
```

## Secrets Management

### Environment Variables

```bash
# ✅ SECURE: Use Wrangler secrets
wrangler secret put JWT_SECRET
wrangler secret put DATABASE_ENCRYPTION_KEY
wrangler secret put API_KEY_ENCRYPTION_KEY

# ❌ INSECURE: Environment variables in code
const secret = process.env.JWT_SECRET; // Don't do this
```

### Secret Rotation

```typescript
class SecretsService {
  async rotateSecret(secretName: string): Promise<void> {
    // 1. Generate new secret
    const newSecret = generateSecureSecret();

    // 2. Update in Cloudflare
    await this.updateCloudflareSecret(secretName, newSecret);

    // 3. Validate new secret works
    await this.validateSecret(secretName);

    // 4. Log rotation event
    await this.auditLog('secret_rotated', { secretName });
  }
}
```

### Secret Access Controls

- **Least Privilege**: Only necessary services have access
- **Audit Logging**: All secret access logged
- **Encryption**: Secrets encrypted in transit and at rest
- **Expiration**: Regular rotation schedule enforced

## Network Security

### HTTPS/TLS Configuration

```typescript
// Enforce HTTPS
const enforceHTTPS = (request: Request): boolean => {
  const url = new URL(request.url);
  return url.protocol === 'https:';
};

// Security headers
const securityHeaders = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Content-Security-Policy': "default-src 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
```

### Rate Limiting

```typescript
class RateLimiter {
  async checkLimit(clientId: string, endpoint: string): Promise<boolean> {
    const key = `rate_limit:${clientId}:${endpoint}`;
    const current = await this.getCount(key);
    const limit = this.getLimitForEndpoint(endpoint);

    if (current >= limit) {
      await this.logRateLimitExceeded(clientId, endpoint);
      return false;
    }

    await this.incrementCount(key);
    return true;
  }
}
```

### DDoS Protection

- **Cloudflare Shield**: Automatic DDoS mitigation
- **Rate Limiting**: Per-IP and per-user limits
- **Geographic Filtering**: Block requests from high-risk regions
- **Bot Detection**: Machine learning-based bot detection

## Audit Logging

### Security Event Logging

```typescript
interface SecurityEvent {
  timestamp: string;
  event_type:
    | 'auth_success'
    | 'auth_failure'
    | 'permission_denied'
    | 'data_access';
  user_id?: string;
  tenant_id: string;
  ip_address: string;
  user_agent: string;
  resource: string;
  action: string;
  result: 'success' | 'failure';
  details?: Record<string, unknown>;
}
```

### Required Logging Events

- Authentication attempts (success/failure)
- Authorization failures
- Data access operations
- Schema modifications
- Administrative actions
- Security policy violations
- Error conditions

### Log Retention

- **Security Logs**: 7 years minimum
- **Access Logs**: 3 years minimum
- **Error Logs**: 1 year minimum
- **Debug Logs**: 30 days maximum

## Incident Response

### Security Incident Classification

1. **P0 - Critical**: Data breach, system compromise
2. **P1 - High**: Authentication bypass, privilege escalation
3. **P2 - Medium**: Denial of service, data integrity issues
4. **P3 - Low**: Security policy violations, suspicious activity

### Response Procedures

```typescript
class IncidentResponse {
  async handleSecurityIncident(incident: SecurityIncident): Promise<void> {
    // 1. Immediate containment
    await this.containThreat(incident);

    // 2. Assessment and investigation
    await this.assessImpact(incident);

    // 3. Notification (if required)
    await this.notifyStakeholders(incident);

    // 4. Remediation
    await this.remediateIssue(incident);

    // 5. Post-incident review
    await this.schedulePostIncidentReview(incident);
  }
}
```

### Contact Information

- **Security Team**: security@healthfees.org
- **Incident Response**: incident-response@healthfees.org
- **24/7 Hotline**: +1-XXX-XXX-XXXX

## Compliance & Governance

### Regulatory Compliance

- **GDPR**: Data protection and privacy rights
- **CCPA**: California consumer privacy
- **SOX**: Financial data controls
- **HIPAA**: Healthcare data protection (if applicable)
- **PCI DSS**: Payment card data security (if applicable)

### Data Privacy Controls

```typescript
// Right to be forgotten (GDPR Article 17)
class DataPrivacyService {
  async deleteUserData(userId: string, tenantId: string): Promise<void> {
    // 1. Identify all user data
    const dataLocations = await this.findUserData(userId, tenantId);

    // 2. Securely delete data
    await this.secureDelete(dataLocations);

    // 3. Verify deletion
    await this.verifyDeletion(userId, tenantId);

    // 4. Log compliance action
    await this.logComplianceAction('data_deletion', { userId, tenantId });
  }
}
```

### Regular Security Reviews

- **Monthly**: Security metrics review
- **Quarterly**: Vulnerability assessments
- **Annually**: Penetration testing
- **Ad-hoc**: Post-incident reviews

## Development Security

### Secure Coding Practices

- **Input Validation**: Validate all inputs at boundaries
- **Output Encoding**: Encode outputs to prevent injection
- **Error Handling**: Never expose sensitive information in errors
- **Logging**: Log security events but not sensitive data
- **Dependencies**: Regular security updates and vulnerability scanning

### Security Testing

```typescript
// Security-focused unit tests
describe('Authentication Security', () => {
  test('should reject invalid JWT tokens', async () => {
    const invalidToken = 'invalid.jwt.token';
    const result = await authService.validateToken(invalidToken);
    expect(result.valid).toBe(false);
  });

  test('should prevent SQL injection', async () => {
    const maliciousInput = "'; DROP TABLE users; --";
    const result = await sqlService.validateQuery(maliciousInput);
    expect(result.isValid).toBe(false);
  });
});
```

### Pre-commit Security Checks

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/PyCQA/bandit
    hooks:
      - id: bandit
        args: ['-r', 'sdk/python/']

  - repo: local
    hooks:
      - id: eslint-security
        name: ESLint Security
        entry: npx eslint --config .eslintrc.security.js
        files: \.(ts|js)$
```

## Monitoring & Alerting

### Security Metrics

- Failed authentication attempts per minute
- Rate limiting activations per hour
- SQL injection attempt detections
- Unusual data access patterns
- Error rates by endpoint
- Response time anomalies

### Alert Thresholds

```typescript
const SECURITY_ALERTS = {
  failed_auth_rate: {
    threshold: 10, // per minute
    severity: 'high',
  },
  sql_injection_attempts: {
    threshold: 1, // any attempt
    severity: 'critical',
  },
  unusual_data_access: {
    threshold: 5, // standard deviations
    severity: 'medium',
  },
};
```

## Security Training

### Required Training Topics

- Secure coding practices
- OWASP Top 10 vulnerabilities
- Data privacy regulations
- Incident response procedures
- Social engineering awareness
- Cloudflare security features

### Training Schedule

- **New Employees**: Within 30 days of hire
- **Annual Refresher**: All employees
- **Quarterly Updates**: Security team
- **Ad-hoc**: Based on threat landscape changes

---

**Document Version**: 1.0.0 **Last Updated**: September 1, 2025 **Next Review**:
December 1, 2025 **Owner**: Security Team **Approver**: CTO
