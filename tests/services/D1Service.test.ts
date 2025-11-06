import { describe, it, expect, vi, beforeEach } from 'vitest';
import { D1Service } from '../../src/services/D1Service';
import { CloudflareEnvironment, EdgeSQLError } from '../../src/types';

// Mock fetch globally
global.fetch = vi.fn();

describe('D1Service', () => {
  let service: D1Service;
  let mockEnv: CloudflareEnvironment;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create mock environment with proper types
    mockEnv = {
      CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
      CLOUDFLARE_API_TOKEN: 'test-api-token',
      LOG_LEVEL: 'info',
    } as unknown as CloudflareEnvironment;

    service = new D1Service(mockEnv);
  });

  describe('listDatabases', () => {
    it('should list all D1 databases', async () => {
      const mockResponse = {
        result: [
          {
            uuid: 'db-1',
            name: 'test-db-1',
            version: '1.0',
            num_tables: 5,
            file_size: 1024,
            created_at: '2024-01-01T00:00:00Z',
          },
          {
            uuid: 'db-2',
            name: 'test-db-2',
            version: '1.0',
            num_tables: 3,
            file_size: 512,
            created_at: '2024-01-02T00:00:00Z',
          },
        ],
        success: true,
        errors: [],
        messages: [],
        result_info: {
          page: 1,
          per_page: 20,
          count: 2,
          total_count: 2,
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
      } as Response);

      const result = await service.listDatabases();

      expect(result).toHaveLength(2);
      expect(result[0].uuid).toBe('db-1');
      expect(result[1].uuid).toBe('db-2');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/test-account-id/d1/database',
        {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer test-api-token',
            'Content-Type': 'application/json',
          },
        }
      );
    });

    it('should handle API errors', async () => {
      const mockResponse = {
        result: [],
        success: false,
        errors: [{ code: 1000, message: 'API Error' }],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
      } as Response);

      await expect(service.listDatabases()).rejects.toThrow(EdgeSQLError);
    });
  });

  describe('createDatabase', () => {
    it('should create a new D1 database', async () => {
      const mockResponse = {
        result: {
          uuid: 'new-db-id',
          name: 'new-database',
          version: '1.0',
          num_tables: 0,
          file_size: 0,
          created_at: '2024-01-01T00:00:00Z',
        },
        success: true,
        errors: [],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
      } as Response);

      const result = await service.createDatabase('new-database');

      expect(result.uuid).toBe('new-db-id');
      expect(result.name).toBe('new-database');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/test-account-id/d1/database',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-api-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'new-database' }),
        }
      );
    });

    it('should create database with location hint', async () => {
      const mockResponse = {
        result: {
          uuid: 'new-db-id',
          name: 'new-database',
          version: '1.0',
          num_tables: 0,
          file_size: 0,
          created_at: '2024-01-01T00:00:00Z',
        },
        success: true,
        errors: [],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
      } as Response);

      await service.createDatabase('new-database', 'weur');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/test-account-id/d1/database',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-api-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'new-database', location: 'weur' }),
        }
      );
    });
  });

  describe('getDatabaseInfo', () => {
    it('should get database information', async () => {
      const mockResponse = {
        result: {
          uuid: 'test-db-id',
          name: 'test-database',
          version: '1.0',
          num_tables: 5,
          file_size: 1024,
          created_at: '2024-01-01T00:00:00Z',
        },
        success: true,
        errors: [],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
      } as Response);

      const result = await service.getDatabaseInfo('test-db-id');

      expect(result.uuid).toBe('test-db-id');
      expect(result.name).toBe('test-database');
      expect(result.num_tables).toBe(5);
    });
  });

  describe('deleteDatabase', () => {
    it('should delete a database', async () => {
      const mockResponse = {
        success: true,
        errors: [],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
      } as Response);

      await service.deleteDatabase('test-db-id');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/test-account-id/d1/database/test-db-id',
        {
          method: 'DELETE',
          headers: {
            'Authorization': 'Bearer test-api-token',
            'Content-Type': 'application/json',
          },
        }
      );
    });
  });

  describe('query', () => {
    it('should execute a SQL query', async () => {
      const mockResponse = {
        result: [
          {
            results: [
              { id: 1, name: 'Test' },
              { id: 2, name: 'Another' },
            ],
            success: true,
            meta: {
              changed_db: false,
              changes: 0,
              duration: 15,
              last_row_id: 0,
              rows_read: 2,
              rows_written: 0,
              size_after: 1024,
            },
          },
        ],
        success: true,
        errors: [],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
      } as Response);

      const result = await service.query('test-db-id', 'SELECT * FROM users');

      expect(result.results).toHaveLength(2);
      expect(result.meta.rows_read).toBe(2);
      expect(result.success).toBe(true);
    });

    it('should execute a query with parameters', async () => {
      const mockResponse = {
        result: [
          {
            results: [{ id: 1, name: 'Test' }],
            success: true,
            meta: {
              changed_db: false,
              changes: 0,
              duration: 10,
              last_row_id: 0,
              rows_read: 1,
              rows_written: 0,
              size_after: 1024,
            },
          },
        ],
        success: true,
        errors: [],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
      } as Response);

      await service.query('test-db-id', 'SELECT * FROM users WHERE id = ?', [1]);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/test-account-id/d1/database/test-db-id/query',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-api-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sql: 'SELECT * FROM users WHERE id = ?',
            params: [1],
          }),
        }
      );
    });
  });

  describe('batch', () => {
    it('should execute multiple queries in batch', async () => {
      const mockResponse = {
        result: [
          {
            results: [],
            success: true,
            meta: {
              changed_db: true,
              changes: 1,
              duration: 10,
              last_row_id: 1,
              rows_read: 0,
              rows_written: 1,
              size_after: 1024,
            },
          },
          {
            results: [],
            success: true,
            meta: {
              changed_db: true,
              changes: 1,
              duration: 8,
              last_row_id: 2,
              rows_read: 0,
              rows_written: 1,
              size_after: 1024,
            },
          },
        ],
        success: true,
        errors: [],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
      } as Response);

      const queries = [
        { sql: 'INSERT INTO users (name) VALUES (?)', params: ['User1'] },
        { sql: 'INSERT INTO users (name) VALUES (?)', params: ['User2'] },
      ];

      const result = await service.batch('test-db-id', queries);

      expect(result).toHaveLength(2);
      expect(result[0].meta.rows_written).toBe(1);
      expect(result[1].meta.rows_written).toBe(1);
    });
  });

  describe('syncShardToD1', () => {
    it('should sync operations from shard to D1', async () => {
      const mockResponse = {
        result: [
          {
            results: [],
            success: true,
            meta: {
              changed_db: true,
              changes: 1,
              duration: 10,
              last_row_id: 1,
              rows_read: 0,
              rows_written: 1,
              size_after: 1024,
            },
          },
        ],
        success: true,
        errors: [],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
      } as Response);

      const operations = [
        { sql: 'INSERT INTO events (data) VALUES (?)', params: ['event1'] },
      ];

      await service.syncShardToD1('test-db-id', 'shard-1', operations);

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should skip sync when no operations provided', async () => {
      await service.syncShardToD1('test-db-id', 'shard-1', []);

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('ensureDatabase', () => {
    it('should return existing database if found', async () => {
      const mockListResponse = {
        result: [
          {
            uuid: 'existing-db-id',
            name: 'existing-database',
            version: '1.0',
            num_tables: 5,
            file_size: 1024,
            created_at: '2024-01-01T00:00:00Z',
          },
        ],
        success: true,
        errors: [],
        messages: [],
        result_info: {
          page: 1,
          per_page: 20,
          count: 1,
          total_count: 1,
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockListResponse,
      } as Response);

      const result = await service.ensureDatabase('existing-database');

      expect(result.uuid).toBe('existing-db-id');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should create new database if not found', async () => {
      const mockListResponse = {
        result: [],
        success: true,
        errors: [],
        messages: [],
        result_info: {
          page: 1,
          per_page: 20,
          count: 0,
          total_count: 0,
        },
      };

      const mockCreateResponse = {
        result: {
          uuid: 'new-db-id',
          name: 'new-database',
          version: '1.0',
          num_tables: 0,
          file_size: 0,
          created_at: '2024-01-01T00:00:00Z',
        },
        success: true,
        errors: [],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          json: async () => mockListResponse,
        } as Response)
        .mockResolvedValueOnce({
          json: async () => mockCreateResponse,
        } as Response);

      const result = await service.ensureDatabase('new-database');

      expect(result.uuid).toBe('new-db-id');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('configuration validation', () => {
    it('should throw error if CLOUDFLARE_ACCOUNT_ID is missing', async () => {
      const invalidEnv = {
        CLOUDFLARE_API_TOKEN: 'test-token',
        LOG_LEVEL: 'info',
      } as unknown as CloudflareEnvironment;

      const invalidService = new D1Service(invalidEnv);

      await expect(invalidService.listDatabases()).rejects.toThrow('CLOUDFLARE_ACCOUNT_ID');
    });

    it('should throw error if CLOUDFLARE_API_TOKEN is missing', async () => {
      const invalidEnv = {
        CLOUDFLARE_ACCOUNT_ID: 'test-account',
        LOG_LEVEL: 'info',
      } as unknown as CloudflareEnvironment;

      const invalidService = new D1Service(invalidEnv);

      await expect(invalidService.listDatabases()).rejects.toThrow('CLOUDFLARE_API_TOKEN');
    });
  });
});
