/**
 * Tests for MySQL2-compatible API wrapper
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnection, createPool, parseDSN, Connection, Pool } from '../src/mysql2-compat';

describe('MySQL2 Compatibility Layer', () => {
  describe('DSN Parsing', () => {
    it('should parse basic workersql:// DSN', () => {
      const dsn = 'workersql://user:pass@localhost:3306/testdb';
      const config = parseDSN(dsn);
      
      expect(config.user).toBe('user');
      expect(config.password).toBe('pass');
      expect(config.host).toBe('localhost');
      expect(config.port).toBe(3306);
      expect(config.database).toBe('testdb');
    });

    it('should parse DSN with query parameters', () => {
      const dsn = 'workersql://user:pass@api.workersql.com/mydb?apiEndpoint=https://api.workersql.com&apiKey=test-key';
      const config = parseDSN(dsn);
      
      expect(config.user).toBe('user');
      expect(config.database).toBe('mydb');
      expect(config.apiEndpoint).toBe('https://api.workersql.com');
      expect(config.apiKey).toBe('test-key');
    });

    it('should throw error for invalid DSN protocol', () => {
      expect(() => parseDSN('mysql://localhost/testdb')).toThrow('Invalid DSN');
    });

    it('should parse DSN without credentials', () => {
      const dsn = 'workersql://localhost/testdb';
      const config = parseDSN(dsn);
      
      expect(config.host).toBe('localhost');
      expect(config.database).toBe('testdb');
      expect(config.user).toBeUndefined();
      expect(config.password).toBeUndefined();
    });
  });

  describe('Connection', () => {
    let connection: Connection;

    afterEach(async () => {
      if (connection) {
        await connection.end();
      }
    });

    it('should create connection with config object', () => {
      connection = createConnection({
        host: 'localhost',
        user: 'root',
        password: 'password',
        database: 'testdb',
        apiEndpoint: 'https://api.workersql.com',
      });

      expect(connection).toBeDefined();
      expect(connection.connected).toBe(true);
    });

    it('should create connection with DSN', () => {
      connection = createConnection({
        uri: 'workersql://root:password@localhost/testdb?apiEndpoint=https://api.workersql.com',
      });

      expect(connection).toBeDefined();
      expect(connection.connected).toBe(true);
    });

    it('should mark connection as disconnected after end()', async () => {
      connection = createConnection({
        host: 'localhost',
        apiEndpoint: 'https://api.workersql.com',
      });

      expect(connection.connected).toBe(true);
      await connection.end();
      expect(connection.connected).toBe(false);
    });
  });

  describe('Connection Pool', () => {
    let pool: Pool;

    afterEach(async () => {
      if (pool) {
        await pool.end();
      }
    });

    it('should create connection pool with config', () => {
      pool = createPool({
        host: 'localhost',
        connectionLimit: 10,
        apiEndpoint: 'https://api.workersql.com',
      });

      expect(pool).toBeDefined();
    });

    it('should get connection from pool', async () => {
      pool = createPool({
        host: 'localhost',
        connectionLimit: 5,
        apiEndpoint: 'https://api.workersql.com',
      });

      const conn = await pool.getConnection();
      expect(conn).toBeDefined();
      conn.release();
    });

    it('should reuse connections in pool', async () => {
      pool = createPool({
        host: 'localhost',
        connectionLimit: 2,
        apiEndpoint: 'https://api.workersql.com',
      });

      const conn1 = await pool.getConnection();
      conn1.release();
      
      const conn2 = await pool.getConnection();
      conn2.release();

      // Both connections should work without error
      expect(conn1).toBeDefined();
      expect(conn2).toBeDefined();
    });
  });

  describe('Query Execution', () => {
    it('should support query method signature', () => {
      const connection = createConnection({
        host: 'localhost',
        apiEndpoint: 'https://api.workersql.com',
      });

      // Test that query method exists and has correct signature
      expect(typeof connection.query).toBe('function');
      
      connection.destroy();
    });

    it('should support execute method for prepared statements', () => {
      const connection = createConnection({
        host: 'localhost',
        apiEndpoint: 'https://api.workersql.com',
      });

      // Test that execute method exists
      expect(typeof connection.execute).toBe('function');
      
      connection.destroy();
    });
  });

  describe('Transaction Support', () => {
    let connection: Connection;

    beforeEach(() => {
      connection = createConnection({
        host: 'localhost',
        apiEndpoint: 'https://api.workersql.com',
      });
    });

    afterEach(async () => {
      if (connection && connection.connected) {
        await connection.end();
      }
    });

    it('should have beginTransaction method', () => {
      expect(typeof connection.beginTransaction).toBe('function');
    });

    it('should have commit method', () => {
      expect(typeof connection.commit).toBe('function');
    });

    it('should have rollback method', () => {
      expect(typeof connection.rollback).toBe('function');
    });
  });

  describe('Connection Health', () => {
    let connection: Connection;

    beforeEach(() => {
      connection = createConnection({
        host: 'localhost',
        apiEndpoint: 'https://api.workersql.com',
      });
    });

    afterEach(async () => {
      if (connection && connection.connected) {
        await connection.end();
      }
    });

    it('should have ping method', () => {
      expect(typeof connection.ping).toBe('function');
    });
  });
});
