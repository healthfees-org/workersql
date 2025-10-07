import { EdgeSQLError } from '../types';
import { BaseService } from './BaseService';
import type { CloudflareEnvironment } from '../types';

/**
 * Encryption algorithm configuration
 */
interface EncryptionConfig {
  algorithm: 'AES-GCM' | 'AES-CBC';
  keyLength: 256;
  ivLength: 12; // For GCM
  tagLength: 128; // For GCM
}

/**
 * Encrypted data structure
 */
interface EncryptedData {
  ciphertext: string; // Base64 encoded
  iv: string; // Base64 encoded initialization vector
  tag?: string; // Base64 encoded authentication tag (for GCM)
  algorithm: string;
  keyVersion: string;
  timestamp: number;
}

/**
 * Data encryption service for optional encryption at rest
 * Uses AES-256-GCM for authenticated encryption
 */
export class DataEncryptionService extends BaseService {
  private readonly config: EncryptionConfig = {
    algorithm: 'AES-GCM',
    keyLength: 256,
    ivLength: 12,
    tagLength: 128,
  };

  private encryptionKey?: CryptoKey;
  private keyVersion: string = 'v1';

  constructor(env: CloudflareEnvironment) {
    super(env);
    void this.initializeEncryption();
  }

  /**
   * Check if encryption is enabled
   */
  isEnabled(): boolean {
    return Boolean(this.env.DATA_ENCRYPTION_ENABLED === 'true');
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  async encryptData(data: string | Uint8Array): Promise<EncryptedData> {
    if (!this.isEnabled()) {
      throw new EdgeSQLError('Data encryption is not enabled', 'ENCRYPTION_DISABLED');
    }

    if (!this.encryptionKey) {
      throw new EdgeSQLError('Encryption key not initialized', 'ENCRYPTION_KEY_MISSING');
    }

    try {
      // Convert data to Uint8Array
      const dataBuffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;

      // Generate random IV
      const iv = crypto.getRandomValues(new Uint8Array(this.config.ivLength));

      // Encrypt the data
      const encrypted = await crypto.subtle.encrypt(
        {
          name: this.config.algorithm,
          iv: iv.buffer as ArrayBuffer,
          tagLength: this.config.tagLength,
        },
        this.encryptionKey,
        (dataBuffer as Uint8Array).buffer as ArrayBuffer
      );

      // Extract ciphertext and authentication tag
      const encryptedArray = new Uint8Array(encrypted);
      const ciphertext = encryptedArray.slice(0, -16); // Remove tag
      const tag = encryptedArray.slice(-16); // Last 16 bytes are the tag

      return {
        ciphertext: this.arrayToBase64(ciphertext),
        iv: this.arrayToBase64(iv),
        tag: this.arrayToBase64(tag),
        algorithm: this.config.algorithm,
        keyVersion: this.keyVersion,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.log('error', 'Data encryption failed', { error: (error as Error).message });
      throw new EdgeSQLError('Data encryption failed', 'ENCRYPTION_FAILED');
    }
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  async decryptData(encryptedData: EncryptedData): Promise<string> {
    if (!this.isEnabled()) {
      throw new EdgeSQLError('Data encryption is not enabled', 'ENCRYPTION_DISABLED');
    }

    if (!this.encryptionKey) {
      throw new EdgeSQLError('Encryption key not initialized', 'ENCRYPTION_KEY_MISSING');
    }

    try {
      // Convert from base64
      const ciphertext = this.base64ToArray(encryptedData.ciphertext);
      const iv = this.base64ToArray(encryptedData.iv);
      const tag = encryptedData.tag ? this.base64ToArray(encryptedData.tag) : new Uint8Array(0);

      // Combine ciphertext and tag
      const encrypted = new Uint8Array(ciphertext.length + tag.length);
      encrypted.set(ciphertext);
      encrypted.set(tag, ciphertext.length);

      // Decrypt the data
      const decrypted = await crypto.subtle.decrypt(
        {
          name: this.config.algorithm,
          iv: iv.buffer as ArrayBuffer,
          tagLength: this.config.tagLength,
        },
        this.encryptionKey,
        encrypted.buffer as ArrayBuffer
      );

      // Convert back to string
      return new TextDecoder().decode(decrypted);
    } catch (error) {
      this.log('error', 'Data decryption failed', { error: (error as Error).message });
      throw new EdgeSQLError('Data decryption failed', 'DECRYPTION_FAILED');
    }
  }

  /**
   * Encrypt sensitive fields in an object
   */
  async encryptObjectFields<T extends Record<string, unknown>>(
    obj: T,
    fieldsToEncrypt: (keyof T)[]
  ): Promise<T & { _encryptedFields: string[] }> {
    if (!this.isEnabled()) {
      return { ...obj, _encryptedFields: [] };
    }

    const encryptedObj = { ...obj };
    const encryptedFields: string[] = [];

    for (const field of fieldsToEncrypt) {
      const value = obj[field];
      if (value !== null && value !== undefined) {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        const encrypted = await this.encryptData(valueStr);
        encryptedObj[field] = encrypted as unknown as T[keyof T];
        encryptedFields.push(field as string);
      }
    }

    return { ...encryptedObj, _encryptedFields: encryptedFields };
  }

  /**
   * Decrypt sensitive fields in an object
   */
  async decryptObjectFields<T extends Record<string, unknown> & { _encryptedFields?: string[] }>(
    obj: T
  ): Promise<T> {
    if (!this.isEnabled() || !obj._encryptedFields) {
      const { _encryptedFields, ...cleanObj } = obj;
      return cleanObj as T;
    }

    const decryptedObj = { ...obj };

    for (const field of obj._encryptedFields) {
      const encryptedData = obj[field] as unknown as EncryptedData;
      if (encryptedData && typeof encryptedData === 'object' && encryptedData.ciphertext) {
        try {
          const decryptedStr = await this.decryptData(encryptedData);
          // Try to parse as JSON, fallback to string
          try {
            (decryptedObj as unknown as Record<string, unknown>)[field] = JSON.parse(
              decryptedStr
            ) as unknown;
          } catch {
            (decryptedObj as unknown as Record<string, unknown>)[field] = decryptedStr as unknown;
          }
        } catch (error) {
          this.log('warn', 'Failed to decrypt field', { field, error: (error as Error).message });
          // Leave encrypted data as-is if decryption fails
        }
      }
    }

    const { _encryptedFields, ...cleanObj } = decryptedObj;
    return cleanObj as T;
  }

  /**
   * Generate a new encryption key (for key rotation)
   */
  async rotateEncryptionKey(): Promise<string> {
    try {
      const newKey = await this.generateEncryptionKey();
      const oldVersion = this.keyVersion;

      // Update to new key
      this.encryptionKey = newKey;
      this.keyVersion = `v${Date.now()}`;

      this.log('info', 'Encryption key rotated', {
        oldVersion,
        newVersion: this.keyVersion,
      });

      // In a production system, you would:
      // 1. Store the old key for decryption of existing data
      // 2. Re-encrypt existing data with the new key
      // 3. Update key version in storage

      return this.keyVersion;
    } catch (error) {
      this.log('error', 'Key rotation failed', { error: (error as Error).message });
      throw new EdgeSQLError('Key rotation failed', 'KEY_ROTATION_FAILED');
    }
  }

  /**
   * Get encryption key fingerprint for verification
   */
  async getKeyFingerprint(): Promise<string> {
    if (!this.encryptionKey) {
      throw new EdgeSQLError('Encryption key not initialized', 'ENCRYPTION_KEY_MISSING');
    }

    try {
      // Export key for fingerprinting (in production, this should be restricted)
      const keyData = await crypto.subtle.exportKey('raw', this.encryptionKey);
      const hash = await crypto.subtle.digest('SHA-256', keyData);
      return this.arrayToBase64(new Uint8Array(hash));
    } catch (error) {
      this.log('error', 'Failed to generate key fingerprint', { error: (error as Error).message });
      throw new EdgeSQLError('Key fingerprint generation failed', 'KEY_FINGERPRINT_FAILED');
    }
  }

  /**
   * Validate encrypted data integrity
   */
  async validateEncryptedData(encryptedData: EncryptedData): Promise<boolean> {
    try {
      // Attempt to decrypt (this will fail if data is corrupted)
      await this.decryptData(encryptedData);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize encryption system
   */
  private async initializeEncryption(): Promise<void> {
    if (!this.isEnabled()) {
      this.log('info', 'Data encryption is disabled');
      return;
    }

    try {
      this.encryptionKey = await this.generateEncryptionKey();
      this.log('info', 'Data encryption initialized', { keyVersion: this.keyVersion });
    } catch (error) {
      this.log('error', 'Failed to initialize encryption', { error: (error as Error).message });
      throw new EdgeSQLError('Encryption initialization failed', 'ENCRYPTION_INIT_FAILED');
    }
  }

  /**
   * Generate encryption key from environment or derive from secret
   */
  private async generateEncryptionKey(): Promise<CryptoKey> {
    let keyMaterial: Uint8Array;

    // Try to get key from environment
    const envKey = this.env.DATA_ENCRYPTION_KEY;
    if (envKey) {
      // Convert base64 key to Uint8Array
      keyMaterial = this.base64ToArray(envKey);
    } else {
      // Derive key from JWT secret or other secret
      const secret = this.env.JWT_SECRET || 'default-encryption-secret';
      const encoder = new TextEncoder();
      const secretData = encoder.encode(secret);
      const hash = await crypto.subtle.digest('SHA-256', secretData.buffer as ArrayBuffer);
      keyMaterial = new Uint8Array(hash);
    }

    // Ensure key is the right length (32 bytes for AES-256)
    if (keyMaterial.length !== 32) {
      // Hash again if needed
      const hash = await crypto.subtle.digest('SHA-256', keyMaterial.buffer as ArrayBuffer);
      keyMaterial = new Uint8Array(hash);
    }

    // Import as AES-GCM key
    return await crypto.subtle.importKey(
      'raw',
      keyMaterial.buffer as ArrayBuffer,
      {
        name: this.config.algorithm,
        length: this.config.keyLength,
      },
      false, // Not extractable
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private arrayToBase64(array: Uint8Array): string {
    const binary = String.fromCharCode(...array);
    return btoa(binary);
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToArray(base64: string): Uint8Array {
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
    return array;
  }

  /**
   * Encrypt sensitive data before storing in database
   */
  async encryptForStorage(
    data: Record<string, unknown>,
    sensitiveFields: string[]
  ): Promise<string> {
    if (!this.isEnabled()) {
      return JSON.stringify(data);
    }

    const encryptedObj = await this.encryptObjectFields(
      data,
      sensitiveFields as (keyof typeof data)[]
    );
    return JSON.stringify(encryptedObj);
  }

  /**
   * Decrypt data retrieved from storage
   */
  async decryptFromStorage<T = Record<string, unknown>>(encryptedData: string): Promise<T> {
    if (!this.isEnabled()) {
      return JSON.parse(encryptedData);
    }

    const parsed = JSON.parse(encryptedData);
    return await this.decryptObjectFields(parsed);
  }

  /**
   * Get encryption statistics
   */
  getEncryptionStats(): {
    enabled: boolean;
    algorithm: string;
    keyVersion: string;
    keyLength: number;
  } {
    return {
      enabled: this.isEnabled(),
      algorithm: this.config.algorithm,
      keyVersion: this.keyVersion,
      keyLength: this.config.keyLength,
    };
  }
}
