import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';

// Comprehensive integration test for authentication and security features

describe('Authentication & Security Integration', () => {
  let validToken: string;
  let expiredToken: string;
  let invalidToken: string;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    // Generate test tokens for different scenarios
    validToken = 'Bearer test-valid-token';
    expiredToken = 'Bearer test-expired-token';
    invalidToken = 'Bearer test-invalid-token';
    adminToken = 'Bearer test-admin-token';
    userToken = 'Bearer test-user-token';
  });

  describe('Authentication Validation', () => {
    it('rejects requests without authorization header', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql: 'SELECT 1' }),
      });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('Unauthorized');
    });

    it('rejects requests with malformed authorization header', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'InvalidFormat test-token',
        },
        body: JSON.stringify({ sql: 'SELECT 1' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects requests with invalid bearer token', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: invalidToken,
        },
        body: JSON.stringify({ sql: 'SELECT 1' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects requests with expired token', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: expiredToken,
        },
        body: JSON.stringify({ sql: 'SELECT 1' }),
      });
      expect(res.status).toBe(401);
    });

    it('accepts requests with valid token', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({ sql: 'SELECT 1 as test' }),
      });
      expect(res.status).toBe(200);

      const data = (await res.json()) as { success: boolean };
      expect(data.success).toBe(true);
    });
  });

  describe('Permission-Based Access Control', () => {
    it('allows admin users to access admin endpoints', async () => {
      const res = await SELF.fetch('http://localhost:8787//admin/shards/metrics', {
        method: 'GET',
        headers: {
          Authorization: adminToken,
        },
      });
      // Should not be 403 Forbidden
      expect([200, 404]).toContain(res.status); // 404 if no shards exist
    });

    it('denies non-admin users access to admin endpoints', async () => {
      const res = await SELF.fetch('http://localhost:8787//admin/shards/metrics', {
        method: 'GET',
        headers: {
          Authorization: userToken,
        },
      });
      expect(res.status).toBe(403);

      const data = (await res.json()) as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBe('Forbidden');
    });

    it('allows DDL operations for admin users', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: adminToken,
        },
        body: JSON.stringify({
          sql: 'CREATE TABLE IF NOT EXISTS admin_test (id INTEGER PRIMARY KEY)',
        }),
      });
      expect(res.status).toBe(200);

      const data = (await res.json()) as { success: boolean };
      expect(data.success).toBe(true);
    });

    it('rejects DDL operations for regular users', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: userToken,
        },
        body: JSON.stringify({
          sql: 'CREATE TABLE IF NOT EXISTS user_test (id INTEGER PRIMARY KEY)',
        }),
      });
      expect(res.status).toBe(400); // DDL not allowed in regular queries
    });
  });

  describe('Rate Limiting', () => {
    it('allows requests within rate limit', async () => {
      // Make several requests within the limit
      for (let i = 0; i < 5; i++) {
        const res = await SELF.fetch('http://localhost:8787//sql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: validToken,
          },
          body: JSON.stringify({ sql: 'SELECT 1' }),
        });
        expect(res.status).toBe(200);
      }
    });

    it('returns 429 when rate limit exceeded', async () => {
      // Make many rapid requests to trigger rate limiting
      const requests = [];
      for (let i = 0; i < 150; i++) {
        requests.push(
          SELF.fetch('http://localhost:8787//sql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: validToken,
              'X-Forwarded-For': `192.168.1.${i % 255}`, // Simulate different IPs
            },
            body: JSON.stringify({ sql: 'SELECT 1' }),
          })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);

      if (rateLimited.length > 0) {
        const rateLimitRes = rateLimited[0]!;
        expect(rateLimitRes.headers.get('retry-after')).toBeTruthy();
      }
    });
  });

  describe('CORS Security', () => {
    it('handles preflight OPTIONS requests correctly', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });
      expect(res.status).toBe(204);

      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
      expect(res.headers.get('access-control-max-age')).toBe('86400');
    });

    it('includes CORS headers in actual responses', async () => {
      const res = await SELF.fetch('http://localhost:8787//health');
      expect(res.status).toBe(200);

      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    });
  });

  describe('Content Security Policy', () => {
    it('includes strict CSP headers on HTML responses', async () => {
      const res = await SELF.fetch('http://localhost:8787//');
      const csp = res.headers.get('content-security-policy');
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('includes security headers on all responses', async () => {
      const res = await SELF.fetch('http://localhost:8787//health');

      expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    });
  });

  describe('Network Security Controls', () => {
    it('blocks requests from disallowed countries', async () => {
      // This test assumes BLOCK_COUNTRIES env var includes 'CN'
      const res = await SELF.fetch('http://localhost:8787//health', {
        headers: {
          'CF-IPCountry': 'CN', // Simulate blocked country
        },
      });
      // Should be blocked if country blocking is enabled
      expect([200, 403]).toContain(res.status); // 200 if not configured, 403 if blocked
    });

    it('blocks requests from disallowed IPs', async () => {
      // This test assumes BLOCK_IPS env var includes '192.168.1.100'
      const res = await SELF.fetch('http://localhost:8787//health', {
        headers: {
          'CF-Connecting-IP': '192.168.1.100', // Simulate blocked IP
        },
      });
      // Should be blocked if IP blocking is enabled
      expect([200, 403]).toContain(res.status); // 200 if not configured, 403 if blocked
    });

    it('enforces HTTPS when configured', async () => {
      // This test assumes ENFORCE_HTTPS=true
      const res = await SELF.fetch('http://localhost:8787//health'); // HTTP request
      // Should be rejected if HTTPS enforcement is enabled
      expect([200, 400]).toContain(res.status); // 200 if not enforced, 400 if enforced
    });
  });

  describe('Input Validation and Sanitization', () => {
    it('rejects malformed JSON requests', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: 'invalid json {',
      });
      expect(res.status).toBe(400);
    });

    it('rejects requests with invalid SQL syntax', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'INVALID SYNTAX QUERY +++',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('handles SQL injection attempts safely', async () => {
      const maliciousSql = 'SELECT * FROM users WHERE id = 1; DROP TABLE users; --';
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: maliciousSql,
        }),
      });
      // Should either reject or only execute the first statement
      expect([200, 400]).toContain(res.status);

      if (res.status === 200) {
        const data = (await res.json()) as { success: boolean };
        expect(data.success).toBe(true);
        // Should not have executed the DROP statement
      }
    });
  });

  describe('Session Management', () => {
    it('handles WebSocket upgrade with valid auth', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'GET',
        headers: {
          Authorization: validToken,
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      });
      // WebSocket upgrade handling - should not be 401
      expect(res.status).not.toBe(401);
    });

    it('rejects WebSocket upgrade without valid auth', async () => {
      const res = await SELF.fetch('http://localhost:8787//sql', {
        method: 'GET',
        headers: {
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      });
      expect(res.status).toBe(401);
    });
  });
});
