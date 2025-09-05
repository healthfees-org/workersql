import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EdgeSQLGateway } from '../../src/gateway';

describe('EdgeSQLGateway - WebSocket Transactions', () => {
  let gateway: EdgeSQLGateway;
  let mockEnv: any;
  let mockCtx: any;

  beforeEach(() => {
    mockEnv = {
      APP_CACHE: {},
      DB_EVENTS: { send: vi.fn() },
      SHARD: {
        idFromName: vi.fn().mockReturnValue('shard_id'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn(
            async (_req: any) =>
              ({
                json: async () => ({ success: true, data: [] }),
              }) as any
          ),
        }),
      },
    };

    mockCtx = {
      waitUntil: vi.fn(),
    };

    gateway = new EdgeSQLGateway(mockEnv, mockCtx);
  });

  describe('Transaction Action Handling', () => {
    it('handles BEGIN transaction', () => {
      const mockConnectionManager = (gateway as any).connections;
      vi.spyOn(mockConnectionManager, 'startTransaction').mockReturnValue(true);

      const result = (gateway as any).handleTransactionAction('sess1', 'begin', 'tx_123');
      expect(result).toBe(true);
      expect(mockConnectionManager.startTransaction).toHaveBeenCalledWith('sess1', 'tx_123');
    });

    it('generates transaction ID if not provided for BEGIN', () => {
      const mockConnectionManager = (gateway as any).connections;
      vi.spyOn(mockConnectionManager, 'startTransaction').mockReturnValue(true);

      const result = (gateway as any).handleTransactionAction('sess1', 'begin');
      expect(result).toBe(true);
      expect(mockConnectionManager.startTransaction).toHaveBeenCalledWith(
        'sess1',
        expect.any(String)
      );
    });

    it('handles COMMIT transaction', () => {
      const mockConnectionManager = (gateway as any).connections;
      vi.spyOn(mockConnectionManager, 'endTransaction').mockReturnValue(true);

      const result = (gateway as any).handleTransactionAction('sess1', 'commit');
      expect(result).toBe(true);
      expect(mockConnectionManager.endTransaction).toHaveBeenCalledWith('sess1');
    });

    it('handles ROLLBACK transaction', () => {
      const mockConnectionManager = (gateway as any).connections;
      vi.spyOn(mockConnectionManager, 'endTransaction').mockReturnValue(true);

      const result = (gateway as any).handleTransactionAction('sess1', 'rollback');
      expect(result).toBe(true);
      expect(mockConnectionManager.endTransaction).toHaveBeenCalledWith('sess1');
    });

    it('returns false for invalid action', () => {
      const result = (gateway as any).handleTransactionAction('sess1', 'invalid' as any);
      expect(result).toBe(false);
    });
  });
});
