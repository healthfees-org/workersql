import { EdgeSQLError } from '../types';
import { BaseService } from './BaseService';
import type { CloudflareEnvironment, AuthContext } from '../types';

/**
 * Authentication token validation system for Edge SQL
 * Supports JWT tokens with tenant isolation and role-based access control
 */
export class AuthService extends BaseService {
  constructor(env: CloudflareEnvironment) {
    super(env);
  }

  /**
   * Validate JWT token and extract authentication context
   */
  async validateToken(token: string): Promise<AuthContext> {
    try {
      // Remove Bearer prefix if present
      const cleanToken = token.replace(/^Bearer\s+/i, '');

      if (!cleanToken || cleanToken.length < 10) {
        throw new EdgeSQLError('Invalid token format', 'AUTH_INVALID_TOKEN');
      }

      // Parse JWT token (simplified implementation)
      const tokenParts = cleanToken.split('.');
      if (tokenParts.length !== 3) {
        throw new EdgeSQLError('Invalid JWT format', 'AUTH_INVALID_JWT');
      }

      const [header, payload, signature] = tokenParts;

      // Verify signature (placeholder - in production use proper JWT library)
      await this.verifyTokenSignature(header!, payload!, signature!);

      // Decode payload
      const decodedPayload = this.decodeBase64Url(payload!);
      const claims = JSON.parse(decodedPayload);

      // Validate token expiration
      this.validateTokenExpiration(claims);

      // Extract authentication context
      return await this.extractAuthContext(claims, cleanToken);
    } catch (error) {
      if (error instanceof EdgeSQLError) {
        throw error;
      }

      this.log('error', 'Token validation failed', { error: (error as Error).message });
      throw new EdgeSQLError('Token validation failed', 'AUTH_VALIDATION_FAILED');
    }
  }

  /**
   * Verify JWT token signature
   */
  private async verifyTokenSignature(
    header: string,
    payload: string,
    signature: string
  ): Promise<void> {
    try {
      // Decode header to get algorithm
      const decodedHeader = JSON.parse(this.decodeBase64Url(header));

      if (decodedHeader.alg !== 'HS256') {
        throw new EdgeSQLError('Unsupported algorithm', 'AUTH_UNSUPPORTED_ALG');
      }

      // Get signing secret from environment
      const secret = this.env.JWT_SECRET;
      if (!secret) {
        throw new EdgeSQLError('JWT secret not configured', 'AUTH_NO_SECRET');
      }

      // Create expected signature
      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret);
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
      );

      const signatureData = encoder.encode(`${header}.${payload}`);
      const expectedSignature = await crypto.subtle.sign('HMAC', key, signatureData);
      const expectedSignatureBase64 = this.encodeBase64Url(new Uint8Array(expectedSignature));

      // Compare signatures
      if (signature !== expectedSignatureBase64) {
        throw new EdgeSQLError('Invalid token signature', 'AUTH_INVALID_SIGNATURE');
      }
    } catch (error) {
      if (error instanceof EdgeSQLError) {
        throw error;
      }
      throw new EdgeSQLError('Signature verification failed', 'AUTH_SIGNATURE_FAILED');
    }
  }

  /**
   * Validate token expiration
   */
  private validateTokenExpiration(claims: any): void {
    const now = Math.floor(Date.now() / 1000);

    // Check expiration
    if (claims.exp && claims.exp < now) {
      throw new EdgeSQLError('Token expired', 'AUTH_TOKEN_EXPIRED');
    }

    // Check not before
    if (claims.nbf && claims.nbf > now) {
      throw new EdgeSQLError('Token not yet valid', 'AUTH_TOKEN_NOT_YET_VALID');
    }
  }

  /**
   * Extract authentication context from JWT claims
   */
  private async extractAuthContext(claims: any, token: string): Promise<AuthContext> {
    // Extract tenant ID
    const tenantId = claims.tenant_id || claims.tid;
    if (!tenantId) {
      throw new EdgeSQLError('Missing tenant ID in token', 'AUTH_MISSING_TENANT');
    }

    // Extract user ID
    const userId = claims.sub || claims.user_id;

    // Extract permissions/roles
    const permissions = claims.permissions || claims.roles || [];
    const normalizedPermissions = Array.isArray(permissions) ? permissions : [permissions];

    // Create token hash for security
    const tokenHash = await this.hashString(token);

    return {
      tenantId,
      userId,
      permissions: normalizedPermissions,
      tokenHash,
    };
  }

  /**
   * Decode base64url string
   */
  private decodeBase64Url(input: string): string {
    // Add padding if needed
    const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
    // Replace base64url chars with base64 chars
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    // Decode
    return atob(base64);
  }

  /**
   * Encode to base64url string
   */
  private encodeBase64Url(input: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...input));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Generate JWT token for testing (development only)
   */
  async generateTestToken(payload: any): Promise<string> {
    if (this.env.ENVIRONMENT === 'production') {
      throw new EdgeSQLError(
        'Test token generation not allowed in production',
        'AUTH_PROD_TEST_TOKEN'
      );
    }

    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };

    const now = Math.floor(Date.now() / 1000);
    const claims = {
      ...payload,
      iat: now,
      exp: now + 3600, // 1 hour expiration
      iss: 'workersql-test',
    };

    const encodedHeader = this.encodeBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const encodedPayload = this.encodeBase64Url(new TextEncoder().encode(JSON.stringify(claims)));

    // Generate signature
    const secret = this.env.JWT_SECRET || 'test-secret-key';
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
    const encodedSignature = this.encodeBase64Url(new Uint8Array(signature));

    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  /**
   * Refresh token validation and renewal
   */
  async refreshToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    // Validate refresh token
    const authContext = await this.validateToken(refreshToken);

    // Check if refresh token has refresh permission
    if (!authContext.permissions.includes('refresh_token')) {
      throw new EdgeSQLError('Invalid refresh token', 'AUTH_INVALID_REFRESH');
    }

    // Generate new access token with shorter expiration
    const newPayload = {
      tenant_id: authContext.tenantId,
      sub: authContext.userId,
      permissions: authContext.permissions.filter((p) => p !== 'refresh_token'), // Remove refresh permission
    };

    const accessToken = await this.generateTestToken(newPayload);

    return {
      accessToken,
      expiresIn: 3600, // 1 hour
    };
  }
}
