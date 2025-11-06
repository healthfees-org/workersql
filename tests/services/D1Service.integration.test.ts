import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueueEventSystem } from '../../src/services/QueueEventSystem';
import { D1Service } from '../../src/services/D1Service';
import { CloudflareEnvironment, DatabaseEvent } from '../../src/types';

// Mock fetch globally
global.fetch = vi.fn();

describe('QueueEventSystem - D1 Integration', () => {
  let queueSystem: QueueEventSystem;
  let mockEnv: CloudflareEnvironment;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEnv = {
      DB_EVENTS: {
        send: vi.fn().mockResolvedValue(undefined),
        sendBatch: vi.fn().mockResolvedValue(undefined),
      },
      APP_CACHE: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
      CLOUDFLARE_API_TOKEN: 'test-api-token',
      PORTABLE_DB_ID: 'test-db-id',
      LOG_LEVEL: 'info',
    } as unknown as CloudflareEnvironment;

    queueSystem = new QueueEventSystem(mockEnv);
  });

  describe('d1_sync event handler', () => {
    it('should sync operations to D1 using REST API', async () => {
      const operations = [
        { sql: 'INSERT INTO events (data) VALUES (?)', params: ['event1'] },
        { sql: 'INSERT INTO events (data) VALUES (?)', params: ['event2'] },
      ];

      const event: DatabaseEvent = {
        type: 'd1_sync',
        shardId: 'shard-1',
        version: Date.now(),
        timestamp: Date.now(),
        payload: JSON.stringify({ operations }),
      };

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
              duration: 10,
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

      const message = {
        id: 'msg-1',
        timestamp: new Date(),
        body: event,
        retry: () => {},
        ack: () => {},
      };

      await queueSystem.processMessage(message);

      // Verify fetch was called with correct D1 REST API endpoint
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/test-account-id/d1/database/test-db-id/query',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-token',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should skip sync when no operations provided', async () => {
      const event: DatabaseEvent = {
        type: 'd1_sync',
        shardId: 'shard-1',
        version: Date.now(),
        timestamp: Date.now(),
        payload: JSON.stringify({ operations: [] }),
      };

      const message = {
        id: 'msg-1',
        timestamp: new Date(),
        body: event,
        retry: () => {},
        ack: () => {},
      };

      await queueSystem.processMessage(message);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should skip sync when PORTABLE_DB_ID not configured', async () => {
      const envWithoutDbId = {
        ...mockEnv,
        PORTABLE_DB_ID: undefined,
      } as unknown as CloudflareEnvironment;

      const queueSystemNoDB = new QueueEventSystem(envWithoutDbId);

      const event: DatabaseEvent = {
        type: 'd1_sync',
        shardId: 'shard-1',
        version: Date.now(),
        timestamp: Date.now(),
        payload: JSON.stringify({
          operations: [{ sql: 'INSERT INTO events (data) VALUES (?)', params: ['event1'] }],
        }),
      };

      const message = {
        id: 'msg-1',
        timestamp: new Date(),
        body: event,
        retry: () => {},
        ack: () => {},
      };

      await queueSystemNoDB.processMessage(message);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle D1 sync errors', async () => {
      const operations = [
        { sql: 'INSERT INTO events (data) VALUES (?)', params: ['event1'] },
      ];

      const event: DatabaseEvent = {
        type: 'd1_sync',
        shardId: 'shard-1',
        version: Date.now(),
        timestamp: Date.now(),
        payload: JSON.stringify({ operations }),
      };

      const mockErrorResponse = {
        result: [],
        success: false,
        errors: [{ code: 1000, message: 'Database error' }],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockErrorResponse,
      } as Response);

      const message = {
        id: 'msg-1',
        timestamp: new Date(),
        body: event,
        retry: () => {},
        ack: () => {},
      };

      await expect(queueSystem.processMessage(message)).rejects.toThrow();
    });
  });

  describe('D1Service integration', () => {
    it('should create D1Service with correct configuration', () => {
      const d1Service = new D1Service(mockEnv);
      expect(d1Service).toBeDefined();
    });

    it('should batch multiple operations efficiently', async () => {
      const d1Service = new D1Service(mockEnv);

      const operations = Array.from({ length: 10 }, (_, i) => ({
        sql: 'INSERT INTO events (data) VALUES (?)',
        params: [`event${i}`],
      }));

      const mockResponse = {
        result: operations.map(() => ({
          results: [],
          success: true,
          meta: {
            changed_db: true,
            changes: 1,
            duration: 5,
            last_row_id: 1,
            rows_read: 0,
            rows_written: 1,
            size_after: 1024,
          },
        })),
        success: true,
        errors: [],
        messages: [],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
      } as Response);

      const results = await d1Service.batch('test-db-id', operations);

      expect(results).toHaveLength(10);
      expect(global.fetch).toHaveBeenCalledTimes(1); // Single batch call
    });
  });
});
