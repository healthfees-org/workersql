import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from '@/services/AuthService';
import { EdgeSQLError } from '@/types';

// Mock crypto.subtle for JWT signature verification
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      importKey: vi.fn().mockResolvedValue('mock-key'),
      sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
      verify: vi.fn().mockResolvedValue(true),
      digest: vi.fn().mockResolvedValue(new Uint8Array([5, 6, 7, 8])),
    },
    randomUUID: vi.fn(() => 'test-uuid'),
  },
});

// Mock TextEncoder and TextDecoder
class MockTextEncoder {
  encode = vi.fn((str: string) => new Uint8Array(Buffer.from(str)));
}
class MockTextDecoder {
  decode = vi.fn((arr: Uint8Array) => Buffer.from(arr).toString());
}

global.TextEncoder = MockTextEncoder as any;
global.TextDecoder = MockTextDecoder as any;

// Mock atob and btoa for base64url
global.atob = vi.fn((str: string) => {
  // Convert base64url to base64
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString();
});
global.btoa = vi.fn((str: string) => {
  // Convert to base64url
  const base64 = Buffer.from(str).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
});

describe('AuthService', () => {
  let authService: AuthService;
  let mockEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = {
      JWT_SECRET: 'test-secret-key',
      ENVIRONMENT: 'development',
      LOG_LEVEL: 'info',
    };
    authService = new AuthService(mockEnv);
  });

  describe('validateToken', () => {
    it('should validate a valid JWT token', async () => {
      const payload = {
        tenant_id: 'tenant123',
        sub: 'user123',
        permissions: ['read', 'write'],
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = await authService.generateTestToken(payload);

      const result = await authService.validateToken(token);

      expect(result.tenantId).toBe('tenant123');
      expect(result.userId).toBe('user123');
      expect(result.permissions).toEqual(['read', 'write']);
      expect(result.tokenHash).toBeDefined();
    });

    it('should handle Bearer prefix', async () => {
      const payload = { tenant_id: 'tenant123', sub: 'user123' };
      const token = await authService.generateTestToken(payload);

      const result = await authService.validateToken(`Bearer ${token}`);

      expect(result.tenantId).toBe('tenant123');
    });

    it('should throw for invalid token format', async () => {
      await expect(authService.validateToken('invalid')).rejects.toThrow(EdgeSQLError);
      await expect(authService.validateToken('')).rejects.toThrow(EdgeSQLError);
    });

    it('should throw for invalid JWT format', async () => {
      await expect(authService.validateToken('header.payload')).rejects.toThrow(EdgeSQLError);
    });

    it('should throw for expired token', async () => {
      // Create an expired token manually instead of using generateTestToken
      const header = { alg: 'HS256', typ: 'JWT' };
      const payload = {
        tenant_id: 'tenant123',
        exp: Math.floor(Date.now() / 1000) - 100, // Expired 100 seconds ago
        iat: Math.floor(Date.now() / 1000) - 200,
      };

      const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

      // Generate signature
      const secret = mockEnv.JWT_SECRET || 'test-secret-key';
      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret);
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const signatureData = encoder.encode(`${encodedHeader}.${encodedPayload}`);
      const signature = await crypto.subtle.sign('HMAC', key, signatureData);
      const encodedSignature = authService['encodeBase64Url'](new Uint8Array(signature));

      const token = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;

      await expect(authService.validateToken(token)).rejects.toThrow(EdgeSQLError);
    });

    it('should throw for token not yet valid', async () => {
      const payload = {
        tenant_id: 'tenant123',
        nbf: Math.floor(Date.now() / 1000) + 100,
      };
      const token = await authService.generateTestToken(payload);

      await expect(authService.validateToken(token)).rejects.toThrow(EdgeSQLError);
    });

    it('should throw for missing tenant ID', async () => {
      const payload = { sub: 'user123' };
      const token = await authService.generateTestToken(payload);

      await expect(authService.validateToken(token)).rejects.toThrow(EdgeSQLError);
    });

    it('should throw for invalid signature', async () => {
      const payload = { tenant_id: 'tenant123' };
      let token = await authService.generateTestToken(payload);
      token = token.replace(/.$/, 'x'); // Tamper with signature

      await expect(authService.validateToken(token)).rejects.toThrow(EdgeSQLError);
    });

    it('should throw for unsupported algorithm', async () => {
      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = { tenant_id: 'tenant123' };
      const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = `${encodedHeader}.${encodedPayload}.signature`;

      await expect(authService.validateToken(token)).rejects.toThrow(EdgeSQLError);
    });

    it('should throw when JWT_SECRET is not configured', async () => {
      mockEnv.JWT_SECRET = undefined;
      const payload = { tenant_id: 'tenant123' };
      const token = await authService.generateTestToken(payload);

      await expect(authService.validateToken(token)).rejects.toThrow(EdgeSQLError);
    });

    it('should handle permissions as string', async () => {
      const payload = {
        tenant_id: 'tenant123',
        permissions: 'admin',
      };
      const token = await authService.generateTestToken(payload);

      const result = await authService.validateToken(token);

      expect(result.permissions).toEqual(['admin']);
    });

    it('should handle missing permissions', async () => {
      const payload = { tenant_id: 'tenant123' };
      const token = await authService.generateTestToken(payload);

      const result = await authService.validateToken(token);

      expect(result.permissions).toEqual([]);
    });
  });

  describe('generateTestToken', () => {
    it('should generate a valid JWT token in development', async () => {
      const payload = { tenant_id: 'tenant123', sub: 'user123' };

      const token = await authService.generateTestToken(payload);

      expect(typeof token).toBe('string');
      const parts = token.split('.');
      expect(parts).toHaveLength(3);

      // Verify we can validate the generated token
      const result = await authService.validateToken(token);
      expect(result.tenantId).toBe('tenant123');
    });

    it('should throw in production environment', async () => {
      mockEnv.ENVIRONMENT = 'production';

      await expect(authService.generateTestToken({})).rejects.toThrow(EdgeSQLError);
    });

    it('should use default secret if JWT_SECRET not set', async () => {
      mockEnv.JWT_SECRET = undefined;
      const payload = { tenant_id: 'tenant123' };

      const token = await authService.generateTestToken(payload);

      expect(typeof token).toBe('string');
    });
  });

  describe('refreshToken', () => {
    it('should refresh a valid token with refresh permission', async () => {
      const payload = {
        tenant_id: 'tenant123',
        sub: 'user123',
        permissions: ['read', 'refresh_token'],
      };
      const refreshToken = await authService.generateTestToken(payload);

      const result = await authService.refreshToken(refreshToken);

      expect(result.accessToken).toBeDefined();
      expect(result.expiresIn).toBe(3600);

      // Verify new token doesn't have refresh permission
      const newAuth = await authService.validateToken(result.accessToken);
      expect(newAuth.permissions).not.toContain('refresh_token');
    });

    it('should throw for token without refresh permission', async () => {
      const payload = {
        tenant_id: 'tenant123',
        permissions: ['read'],
      };
      const refreshToken = await authService.generateTestToken(payload);

      await expect(authService.refreshToken(refreshToken)).rejects.toThrow(EdgeSQLError);
    });

    it('should throw for invalid refresh token', async () => {
      await expect(authService.refreshToken('invalid')).rejects.toThrow(EdgeSQLError);
    });
  });

  describe('private methods coverage via public methods', () => {
    it('should cover decodeBase64Url and encodeBase64Url through token generation/validation', async () => {
      const payload = { tenant_id: 'tenant123' };
      const token = await authService.generateTestToken(payload);

      // This will exercise decodeBase64Url in validateToken
      await authService.validateToken(token);
    });

    it('should cover validateTokenExpiration through expired token test', async () => {
      // Create an expired token manually
      const header = { alg: 'HS256', typ: 'JWT' };
      const payload = {
        tenant_id: 'tenant123',
        exp: Math.floor(Date.now() / 1000) - 100, // Expired 100 seconds ago
        iat: Math.floor(Date.now() / 1000) - 200,
      };

      const encodedHeader = btoa(JSON.stringify(header))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      const encodedPayload = btoa(JSON.stringify(payload))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      // Generate signature
      const secret = mockEnv.JWT_SECRET || 'test-secret-key';
      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret);
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const signatureData = encoder.encode(`${encodedHeader}.${encodedPayload}`);
      const signature = await crypto.subtle.sign('HMAC', key, signatureData);
      const encodedSignature = authService['encodeBase64Url'](new Uint8Array(signature));

      const token = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;

      await expect(authService.validateToken(token)).rejects.toThrow(EdgeSQLError);
    });

    it('should cover extractAuthContext through valid token validation', async () => {
      const payload = {
        tenant_id: 'tenant123',
        sub: 'user123',
        permissions: ['read'],
      };
      const token = await authService.generateTestToken(payload);

      const result = await authService.validateToken(token);

      expect(result.tenantId).toBe('tenant123');
      expect(result.userId).toBe('user123');
      expect(result.permissions).toEqual(['read']);
    });
  });
});
