/**
 * Tests for WorkerSQL Client
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { WorkerSQLClient } from '../src/index.js';
import { ValidationError } from '../../schema/validator.js';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WorkerSQLClient', () => {
  let client: WorkerSQLClient;

  afterEach(async () => {
    if (client) {
      await client.close();
    }
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with DSN string', () => {
      const mockCreate = jest.fn().mockReturnValue({
        post: jest.fn(),
        get: jest.fn(),
      });
      mockedAxios.create = mockCreate;

      client = new WorkerSQLClient('workersql://api.test.com/mydb?apiKey=test-key');

      expect(client).toBeDefined();
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should initialize with config object', () => {
      const mockCreate = jest.fn().mockReturnValue({
        post: jest.fn(),
        get: jest.fn(),
      });
      mockedAxios.create = mockCreate;

      client = new WorkerSQLClient({
        host: 'api.test.com',
        database: 'mydb',
        username: 'user',
        password: 'pass',
        apiKey: 'test-key',
      });

      expect(client).toBeDefined();
    });

    it('should initialize with pooling enabled', () => {
      const mockCreate = jest.fn().mockReturnValue({
        post: jest.fn(),
        get: jest.fn(),
      });
      mockedAxios.create = mockCreate;

      client = new WorkerSQLClient({
        host: 'api.test.com',
        database: 'mydb',
        apiKey: 'test-key',
        pooling: {
          enabled: true,
          minConnections: 2,
          maxConnections: 10,
        },
      });

      const stats = client.getPoolStats();
      expect(stats).toBeDefined();
      expect(stats?.minConnections).toBe(2);
      expect(stats?.maxConnections).toBe(10);
    });

    it('should throw error for missing configuration', () => {
      expect(() => new WorkerSQLClient({})).toThrow();
    });
  });

  describe('query', () => {
    beforeEach(() => {
      const mockAxiosInstance = {
        post: jest.fn(),
        get: jest.fn(),
      };
      mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      client = new WorkerSQLClient({
        host: 'api.test.com',
        database: 'mydb',
        apiKey: 'test-key',
        pooling: { enabled: false },
      });
    });

    it('should execute query successfully', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: [{ id: 1, name: 'Test' }],
          rowCount: 1,
        },
      };

      const mockAxiosInstance = mockedAxios.create() as any;
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await client.query('SELECT * FROM users');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([{ id: 1, name: 'Test' }]);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/query',
        expect.objectContaining({
          sql: 'SELECT * FROM users',
        })
      );
    });

    it('should execute query with parameters', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: [{ id: 1 }],
          rowCount: 1,
        },
      };

      const mockAxiosInstance = mockedAxios.create() as any;
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      await client.query('SELECT * FROM users WHERE id = ?', [1]);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/query',
        expect.objectContaining({
          sql: 'SELECT * FROM users WHERE id = ?',
          params: [1],
        })
      );
    });

    it('should handle query errors', async () => {
      const mockAxiosInstance = mockedAxios.create() as any;
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      await expect(client.query('SELECT * FROM users')).rejects.toThrow();
    });

    it('should validate SQL injection attempts', async () => {
      await expect(
        client.query('SELECT * FROM users; DROP TABLE users;')
      ).rejects.toThrow();
    });
  });

  describe('batchQuery', () => {
    beforeEach(() => {
      const mockAxiosInstance = {
        post: jest.fn(),
        get: jest.fn(),
      };
      mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      client = new WorkerSQLClient({
        host: 'api.test.com',
        database: 'mydb',
        apiKey: 'test-key',
        pooling: { enabled: false },
      });
    });

    it('should execute batch queries', async () => {
      const mockResponse = {
        data: {
          success: true,
          results: [
            { success: true, data: [], rowCount: 1 },
            { success: true, data: [], rowCount: 1 },
          ],
        },
      };

      const mockAxiosInstance = mockedAxios.create() as any;
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const queries = [
        { sql: 'INSERT INTO users (name) VALUES (?)', params: ['User1'] },
        { sql: 'INSERT INTO users (name) VALUES (?)', params: ['User2'] },
      ];

      const result = await client.batchQuery(queries);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
    });

    it('should execute batch queries in transaction', async () => {
      const mockResponse = {
        data: {
          success: true,
          results: [],
        },
      };

      const mockAxiosInstance = mockedAxios.create() as any;
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const queries = [
        { sql: 'INSERT INTO users (name) VALUES (?)', params: ['User1'] },
      ];

      await client.batchQuery(queries, { transaction: true });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/batch',
        expect.objectContaining({
          transaction: true,
        })
      );
    });
  });

  describe('transaction', () => {
    beforeEach(() => {
      const mockAxiosInstance = {
        post: jest.fn(),
        get: jest.fn(),
      };
      mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      client = new WorkerSQLClient({
        host: 'api.test.com',
        database: 'mydb',
        apiKey: 'test-key',
        pooling: { enabled: false },
      });
    });

    it('should execute transaction successfully', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: [],
        },
      };

      const mockAxiosInstance = mockedAxios.create() as any;
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      await client.transaction(async (txn) => {
        await txn.query('INSERT INTO users (name) VALUES (?)', ['User1']);
        await txn.query('INSERT INTO users (name) VALUES (?)', ['User2']);
      });

      // Transaction should commit
      expect(mockAxiosInstance.post).toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: [],
        },
      };

      const mockAxiosInstance = mockedAxios.create() as any;
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      await expect(
        client.transaction(async (txn) => {
          await txn.query('INSERT INTO users (name) VALUES (?)', ['User1']);
          throw new Error('Transaction error');
        })
      ).rejects.toThrow('Transaction error');

      // Transaction should rollback
      expect(mockAxiosInstance.post).toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      const mockAxiosInstance = {
        post: jest.fn(),
        get: jest.fn(),
      };
      mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      client = new WorkerSQLClient({
        host: 'api.test.com',
        database: 'mydb',
        apiKey: 'test-key',
        pooling: { enabled: false },
      });
    });

    it('should check service health', async () => {
      const mockResponse = {
        data: {
          status: 'healthy',
          database: { connected: true },
          cache: { enabled: true },
          timestamp: '2025-09-01T12:00:00Z',
        },
      };

      const mockAxiosInstance = mockedAxios.create() as any;
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.database.connected).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/health');
    });
  });

  describe('connection pooling', () => {
    it('should use connection pool when enabled', async () => {
      const mockAxiosInstance = {
        post: jest.fn().mockResolvedValue({
          data: { success: true, data: [] },
        }),
        get: jest.fn(),
      };
      mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      client = new WorkerSQLClient({
        host: 'api.test.com',
        database: 'mydb',
        apiKey: 'test-key',
        pooling: {
          enabled: true,
          minConnections: 2,
        },
      });

      const stats = client.getPoolStats();
      expect(stats?.total).toBe(2);

      await client.query('SELECT 1');

      const statsAfter = client.getPoolStats();
      expect(statsAfter).toBeDefined();
    });

    it('should not use connection pool when disabled', () => {
      const mockAxiosInstance = {
        post: jest.fn(),
        get: jest.fn(),
      };
      mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      client = new WorkerSQLClient({
        host: 'api.test.com',
        database: 'mydb',
        apiKey: 'test-key',
        pooling: { enabled: false },
      });

      const stats = client.getPoolStats();
      expect(stats).toBeUndefined();
    });
  });

  describe('retry logic', () => {
    it('should retry on transient errors', async () => {
      const mockAxiosInstance = {
        post: jest.fn()
          .mockRejectedValueOnce(new Error('ECONNREFUSED'))
          .mockResolvedValue({
            data: { success: true, data: [] },
          }),
        get: jest.fn(),
      };
      mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      client = new WorkerSQLClient({
        host: 'api.test.com',
        database: 'mydb',
        apiKey: 'test-key',
        retryAttempts: 3,
        retryDelay: 10,
        pooling: { enabled: false },
      });

      const result = await client.query('SELECT 1');

      expect(result.success).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });
  });
});
