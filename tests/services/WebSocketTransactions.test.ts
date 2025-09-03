import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EdgeSQLGateway } from '../../src/gateway';

describe('EdgeSQLGateway - WebSocket Transactions', () => {
  let gateway: EdgeSQLGateway;
  let mockEnv: any;
  let mockCtx: any;

  beforeEach(() => {
    mockEnv = {
      APP_CACHE: {},
      DB_EVENTS: { send: jest.fn() },
      SHARD: {
        idFromName: jest.fn().mockReturnValue('shard_id'),
        get: jest.fn().mockReturnValue({
          fetch: jest.fn(
            async (_req: any) =>
              ({
                json: async () => ({ success: true, data: [] }),
              }) as any
          ),
        }),
      },
    };

    mockCtx = {
      waitUntil: jest.fn(),
    };

    gateway = new EdgeSQLGateway(mockEnv, mockCtx);
  });

  describe('Transaction Action Handling', () => {
    it('handles BEGIN transaction', () => {
      const mockConnectionManager = (gateway as any).connections;
      jest.spyOn(mockConnectionManager, 'startTransaction').mockReturnValue(true);

      const result = (gateway as any).handleTransactionAction('sess1', 'begin', 'tx_123');
      expect(result).toBe(true);
      expect(mockConnectionManager.startTransaction).toHaveBeenCalledWith('sess1', 'tx_123');
    });

    it('generates transaction ID if not provided for BEGIN', () => {
      const mockConnectionManager = (gateway as any).connections;
      jest.spyOn(mockConnectionManager, 'startTransaction').mockReturnValue(true);

      const result = (gateway as any).handleTransactionAction('sess1', 'begin');
      expect(result).toBe(true);
      expect(mockConnectionManager.startTransaction).toHaveBeenCalledWith(
        'sess1',
        expect.any(String)
      );
    });

    it('handles COMMIT transaction', () => {
      const mockConnectionManager = (gateway as any).connections;
      jest.spyOn(mockConnectionManager, 'endTransaction').mockReturnValue(true);

      const result = (gateway as any).handleTransactionAction('sess1', 'commit');
      expect(result).toBe(true);
      expect(mockConnectionManager.endTransaction).toHaveBeenCalledWith('sess1');
    });

    it('handles ROLLBACK transaction', () => {
      const mockConnectionManager = (gateway as any).connections;
      jest.spyOn(mockConnectionManager, 'endTransaction').mockReturnValue(true);

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
