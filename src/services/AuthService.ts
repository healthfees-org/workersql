import { EdgeSQLError } from '../types';
import { BaseService } from './BaseService';
import type { CloudflareEnvironment, AuthContext } from '../types';

/**
 * Represents the payload of a JWT token.
 */
interface JwtClaims {
  tenant_id?: string;
  tid?: string;
  sub?: string;
  user_id?: string;
  permissions?: string | string[];
  roles?: string | string[];
  exp?: number;
  nbf?: number;
  [key: string]: unknown; // Allow other claims
}

/**
 * Cloudflare Access JWT claims structure
 */
interface CloudflareAccessClaims {
  aud: string[]; // Application Audience (AUD) tags
  email: string;
  exp: number;
  iat: number;
  iss: string; // https://<team-name>.cloudflareaccess.com
  nonce?: string;
  sub: string; // User ID
  country?: string;
  custom?: Record<string, unknown>; // Custom claims
  groups?: string[]; // SAML/OIDC groups
  identity_nonce?: string;
  service_token_id?: string;
  service_token_status?: boolean;
}

/**
 * Authentication token validation system for Edge SQL
 * Supports JWT tokens with tenant isolation and role-based access control
 * Enhanced with Cloudflare Zero Trust integration
 */
export class AuthService extends BaseService {
  private readonly cfAccessIssuerPattern = /^https:\/\/[a-zA-Z0-9-]+\.cloudflareaccess\.com$/;

  constructor(env: CloudflareEnvironment) {
    super(env);
  }

  /**
   * Validate JWT token and extract authentication context
   * Supports both custom JWT and Cloudflare Access tokens
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

      const [header, payload, _signature] = tokenParts;

      // Decode header to get algorithm
      const decodedHeader = JSON.parse(this.decodeBase64Url(header!));
      const algorithm = decodedHeader.alg;

      // Decode payload to determine token type
      const decodedPayload = this.decodeBase64Url(payload!);
      const claims = JSON.parse(decodedPayload) as JwtClaims & CloudflareAccessClaims;

      // Determine token type and validate accordingly
      if (this.isCloudflareAccessToken(claims)) {
        return await this.validateCloudflareAccessToken(cleanToken, claims, algorithm);
      } else {
        return await this.validateCustomToken(cleanToken, claims, algorithm);
      }
    } catch (error) {
      if (error instanceof EdgeSQLError) {
        throw error;
      }

      this.log('error', 'Token validation failed', { error: (error as Error).message });
      throw new EdgeSQLError('Token validation failed', 'AUTH_VALIDATION_FAILED');
    }
  }

  /**
   * Check if token is a Cloudflare Access token
   */
  private isCloudflareAccessToken(claims: JwtClaims & CloudflareAccessClaims): boolean {
    return Boolean(
      claims.iss &&
        this.cfAccessIssuerPattern.test(claims.iss) &&
        claims.aud &&
        Array.isArray(claims.aud) &&
        claims.email &&
        claims.sub
    );
  }

  /**
   * Validate Cloudflare Access token
   */
  private async validateCloudflareAccessToken(
    token: string,
    claims: CloudflareAccessClaims,
    _algorithm: string
  ): Promise<AuthContext> {
    // Validate issuer
    if (!this.cfAccessIssuerPattern.test(claims.iss)) {
      throw new EdgeSQLError('Invalid Cloudflare Access issuer', 'AUTH_INVALID_ISSUER');
    }

    // Validate audience (application AUD tag)
    const expectedAud = this.env.CLOUDFLARE_ACCESS_AUD;
    if (expectedAud && !claims.aud.includes(expectedAud)) {
      throw new EdgeSQLError(
        'Invalid audience for Cloudflare Access token',
        'AUTH_INVALID_AUDIENCE'
      );
    }

    // Validate expiration
    this.validateTokenExpiration(claims as unknown as JwtClaims);

    // Verify signature using Cloudflare's public key
    await this.verifyCloudflareAccessSignature(token, claims);

    // Extract authentication context from Cloudflare Access claims
    return await this.extractCloudflareAccessContext(claims, token);
  }

  /**
   * Validate custom JWT token
   */
  private async validateCustomToken(
    token: string,
    claims: JwtClaims,
    algorithm: string
  ): Promise<AuthContext> {
    // Validate algorithm
    if (algorithm !== 'HS256' && algorithm !== 'RS256') {
      throw new EdgeSQLError('Unsupported algorithm', 'AUTH_UNSUPPORTED_ALG');
    }

    // Validate expiration
    this.validateTokenExpiration(claims);

    // Verify signature
    if (algorithm === 'HS256') {
      await this.verifyHmacSignature(token, claims);
    } else {
      await this.verifyRsaSignature(token, claims);
    }

    // Extract authentication context
    return await this.extractAuthContext(claims, token);
  }

  /**
   * Verify Cloudflare Access token signature
   */
  private async verifyCloudflareAccessSignature(
    token: string,
    claims: CloudflareAccessClaims
  ): Promise<void> {
    try {
      // Fetch Cloudflare's public key for the team
      const publicKey = await this.fetchCloudflarePublicKey(claims.iss);

      // Import the public key
      const key = await crypto.subtle.importKey(
        'jwk',
        publicKey,
        {
          name: 'RSASSA-PKCS1-v1_5',
          hash: 'SHA-256',
        },
        false,
        ['verify']
      );

      // Verify the signature
      const encoder = new TextEncoder();
      const signatureData = encoder.encode(`${token.split('.')[0]}.${token.split('.')[1]}`);
      const signature = this.decodeBase64Url(token.split('.')[2]!);

      const signatureArray = new Uint8Array(signature.length);
      for (let i = 0; i < signature.length; i++) {
        signatureArray[i] = signature.charCodeAt(i);
      }

      const isValid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        signatureArray,
        signatureData
      );

      if (!isValid) {
        throw new EdgeSQLError(
          'Invalid Cloudflare Access token signature',
          'AUTH_INVALID_SIGNATURE'
        );
      }
    } catch (error) {
      if (error instanceof EdgeSQLError) {
        throw error;
      }
      throw new EdgeSQLError(
        'Cloudflare Access signature verification failed',
        'AUTH_SIGNATURE_FAILED'
      );
    }
  }

  /**
   * Fetch Cloudflare public key for token verification
   */
  private async fetchCloudflarePublicKey(issuer: string): Promise<JsonWebKey> {
    // Extract team name from issuer
    const teamMatch = issuer.match(/^https:\/\/([a-zA-Z0-9-]+)\.cloudflareaccess\.com$/);
    if (!teamMatch) {
      throw new EdgeSQLError('Invalid Cloudflare Access issuer format', 'AUTH_INVALID_ISSUER');
    }

    const teamName = teamMatch[1];
    const certsUrl = `https://${teamName}.cloudflareaccess.com/cdn-cgi/access/certs`;

    try {
      const response = await fetch(certsUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch certificates: ${response.status}`);
      }

      const certs = (await response.json()) as { keys: JsonWebKey[] };

      // For simplicity, return the first key (in production, match by 'kid' claim)
      if (!certs.keys || certs.keys.length === 0) {
        throw new Error('No public keys available');
      }

      return certs.keys[0]!;
    } catch (error) {
      this.log('error', 'Failed to fetch Cloudflare public key', {
        error: (error as Error).message,
      });
      throw new EdgeSQLError('Unable to verify Cloudflare Access token', 'AUTH_CERT_FETCH_FAILED');
    }
  }

  /**
   * Extract authentication context from Cloudflare Access claims
   */
  private async extractCloudflareAccessContext(
    claims: CloudflareAccessClaims,
    token: string
  ): Promise<AuthContext> {
    // Extract tenant ID from custom claims or email domain
    const tenantId = this.extractTenantFromCloudflareClaims(claims);

    // Extract user ID
    const userId = claims.sub;

    // Map groups to permissions/roles
    const permissions = this.mapCloudflareGroupsToPermissions(claims.groups || []);

    // Create token hash for security
    const tokenHash = await this.hashString(token);

    const authContext: AuthContext & {
      cfAccess?: { email: string; country?: string; groups?: string[]; serviceToken: boolean };
    } = {
      tenantId,
      permissions,
      tokenHash,
      userId,
    };

    // Add additional metadata for Cloudflare Access
    const cfMeta: { email: string; country?: string; groups?: string[]; serviceToken: boolean } = {
      email: claims.email,
      serviceToken: claims.service_token_id ? true : false,
    };
    if (claims.country) {
      cfMeta.country = claims.country;
    }
    if (claims.groups) {
      cfMeta.groups = claims.groups;
    }
    authContext.cfAccess = cfMeta;

    return authContext;
  }

  /**
   * Extract tenant ID from Cloudflare Access claims
   */
  private extractTenantFromCloudflareClaims(claims: CloudflareAccessClaims): string {
    // Try custom claims first
    if (claims.custom?.['tenant_id']) {
      return String(claims.custom['tenant_id']);
    }

    // Fallback to email domain
    const emailDomain = claims.email.split('@')[1];
    if (emailDomain) {
      return emailDomain.replace(/\./g, '-');
    }

    // Final fallback
    throw new EdgeSQLError(
      'Unable to determine tenant ID from Cloudflare Access token',
      'AUTH_MISSING_TENANT'
    );
  }

  /**
   * Map Cloudflare groups to permissions
   */
  private mapCloudflareGroupsToPermissions(groups: string[]): string[] {
    const permissions: string[] = [];

    // Map common group names to permissions
    const groupMappings: Record<string, string[]> = {
      admin: ['admin', 'read', 'write', 'delete'],
      developer: ['read', 'write'],
      analyst: ['read'],
      auditor: ['read_audit_logs'],
    };

    groups.forEach((group) => {
      const groupLower = group.toLowerCase();
      const mappedPermissions = groupMappings[groupLower];
      if (mappedPermissions) {
        permissions.push(...mappedPermissions);
      }
    });

    // Ensure at least basic read permission
    if (permissions.length === 0) {
      permissions.push('read');
    }

    return [...new Set(permissions)]; // Remove duplicates
  }

  /**
   * Verify HMAC signature for custom tokens
   */
  private async verifyHmacSignature(token: string, _claims: JwtClaims): Promise<void> {
    try {
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

      const signatureData = encoder.encode(`${token.split('.')[0]}.${token.split('.')[1]}`);
      const expectedSignature = await crypto.subtle.sign('HMAC', key, signatureData);
      const expectedSignatureBase64 = this.encodeBase64Url(new Uint8Array(expectedSignature));

      const providedSignature = token.split('.')[2];
      if (providedSignature !== expectedSignatureBase64) {
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
   * Verify RSA signature for custom tokens
   */
  private async verifyRsaSignature(_token: string, _claims: JwtClaims): Promise<void> {
    // For RSA, we'd need the public key from JWKS endpoint
    // This is a placeholder for RSA signature verification
    throw new EdgeSQLError(
      'RSA signature verification not implemented',
      'AUTH_RSA_NOT_IMPLEMENTED'
    );
  }

  /**
   * Validate token expiration
   */
  private validateTokenExpiration(claims: JwtClaims): void {
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
  private async extractAuthContext(claims: JwtClaims, token: string): Promise<AuthContext> {
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

    const authContext: AuthContext = {
      tenantId: String(tenantId),
      permissions: normalizedPermissions.map(String),
      tokenHash,
    };

    if (userId) {
      authContext.userId = String(userId);
    }

    return authContext;
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
  async generateTestToken(payload: Record<string, unknown>): Promise<string> {
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

  /**
   * Validate API token for service-to-service authentication
   */
  async validateApiToken(token: string): Promise<AuthContext> {
    try {
      // Check if token matches configured API tokens
      const validTokens = (this.env.API_TOKENS || '').split(',').map((t: string) => t.trim());

      if (!validTokens.includes(token)) {
        throw new EdgeSQLError('Invalid API token', 'AUTH_INVALID_API_TOKEN');
      }

      // Create service authentication context
      const tokenHash = await this.hashString(token);

      return {
        tenantId: 'service', // Service tenant for API operations
        permissions: ['admin', 'read', 'write', 'delete'],
        tokenHash,
        userId: 'api-service',
      };
    } catch (error) {
      if (error instanceof EdgeSQLError) {
        throw error;
      }
      throw new EdgeSQLError('API token validation failed', 'AUTH_API_TOKEN_FAILED');
    }
  }

  /**
   * Hash string for security purposes
   */
  protected override async hashString(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}
