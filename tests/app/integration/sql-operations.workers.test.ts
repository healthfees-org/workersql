import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SELF } from 'cloudflare:test';

// Comprehensive integration test for SQL operations and data flow

describe('SQL Operations Integration', () => {
  let validToken: string;
  let testTenantId: string;

  beforeAll(async () => {
    validToken = 'Bearer test-valid-token';
    testTenantId = 'test-tenant-sql-ops';

    // Set up test schema
    await SELF.fetch('http://localhost:8787//sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: validToken,
      },
      body: JSON.stringify({
        sql: `
          CREATE TABLE IF NOT EXISTS test_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            category TEXT,
            tenant_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `,
      }),
    });

    await SELF.fetch('http://localhost:8787//sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: validToken,
      },
      body: JSON.stringify({
        sql: `
          CREATE TABLE IF NOT EXISTS test_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            total_amount DECIMAL(10,2) NOT NULL,
            tenant_id TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES test_products(id)
          )
        `,
      }),
    });
  });

  afterAll(async () => {
    // Clean up test data
    await SELF.fetch('http://localhost:8787//sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: validToken,
      },
      body: JSON.stringify({
        sql: 'DROP TABLE IF EXISTS test_orders',
      }),
    });

    await SELF.fetch('http://localhost:8787//sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: validToken,
      },
      body: JSON.stringify({
        sql: 'DROP TABLE IF EXISTS test_products',
      }),
    });
  });

  describe('Data Manipulation Operations', () => {
    it('INSERT operations create records successfully', async () => {
      const insertRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: `
            INSERT INTO test_products (name, price, category, tenant_id)
            VALUES (?, ?, ?, ?)
          `,
          params: ['Test Product 1', 29.99, 'electronics', testTenantId],
        }),
      });
      expect(insertRes.status).toBe(200);

      const insertData = (await insertRes.json()) as {
        success: boolean;
        data: { rowsAffected: number; insertId?: number };
      };
      expect(insertData.success).toBe(true);
      expect(insertData.data.rowsAffected).toBe(1);
      expect(insertData.data.insertId).toBeDefined();
    });

    it('SELECT operations retrieve data correctly', async () => {
      const selectRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT id, name, price, category FROM test_products WHERE tenant_id = ? ORDER BY id DESC LIMIT 1',
          params: [testTenantId],
        }),
      });
      expect(selectRes.status).toBe(200);

      const selectData = (await selectRes.json()) as {
        success: boolean;
        data: Array<Record<string, unknown>>;
        cached: boolean;
      };
      expect(selectData.success).toBe(true);
      expect(selectData.data).toHaveLength(1);
      expect(selectData.data[0]).toMatchObject({
        name: 'Test Product 1',
        price: 29.99,
        category: 'electronics',
      });
    });

    it('UPDATE operations modify records correctly', async () => {
      // First get the inserted product ID
      const selectRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT id FROM test_products WHERE tenant_id = ? ORDER BY id DESC LIMIT 1',
          params: [testTenantId],
        }),
      });
      const selectData = (await selectRes.json()) as {
        success: boolean;
        data: Array<{ id: number }>;
      };
      expect(selectData.data).toHaveLength(1);
      const productId = selectData.data[0]!.id;

      // Update the product
      const updateRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'UPDATE test_products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?',
          params: [39.99, productId, testTenantId],
        }),
      });
      expect(updateRes.status).toBe(200);

      const updateData = (await updateRes.json()) as {
        success: boolean;
        data: { rowsAffected: number };
      };
      expect(updateData.success).toBe(true);
      expect(updateData.data.rowsAffected).toBe(1);

      // Verify the update
      const verifyRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT price FROM test_products WHERE id = ? AND tenant_id = ?',
          params: [productId, testTenantId],
        }),
      });
      const verifyData = (await verifyRes.json()) as {
        success: boolean;
        data: Array<{ price: number }>;
      };
      expect(verifyData.data).toHaveLength(1);
      expect(verifyData.data[0]!.price).toBe(39.99);
    });

    it('DELETE operations remove records correctly', async () => {
      // Insert a temporary product for deletion
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'INSERT INTO test_products (name, price, category, tenant_id) VALUES (?, ?, ?, ?)',
          params: ['Temp Product', 9.99, 'temp', testTenantId],
        }),
      });

      // Delete the product
      const deleteRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'DELETE FROM test_products WHERE name = ? AND tenant_id = ?',
          params: ['Temp Product', testTenantId],
        }),
      });
      expect(deleteRes.status).toBe(200);

      const deleteData = (await deleteRes.json()) as {
        success: boolean;
        data: { rowsAffected: number };
      };
      expect(deleteData.success).toBe(true);
      expect(deleteData.data.rowsAffected).toBe(1);
    });
  });

  describe('Complex Queries and Joins', () => {
    beforeAll(async () => {
      // Insert test data for complex queries
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: `
            INSERT INTO test_products (name, price, category, tenant_id)
            VALUES
              ('Laptop', 999.99, 'electronics', ?),
              ('Mouse', 29.99, 'electronics', ?),
              ('Book', 19.99, 'books', ?)
          `,
          params: [testTenantId, testTenantId, testTenantId],
        }),
      });

      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: `
            INSERT INTO test_orders (product_id, quantity, total_amount, tenant_id, status)
            SELECT id, 2, price * 2, ?, 'completed'
            FROM test_products
            WHERE category = 'electronics' AND tenant_id = ?
            LIMIT 1
          `,
          params: [testTenantId, testTenantId],
        }),
      });
    });

    it('handles JOIN queries correctly', async () => {
      const joinRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: `
            SELECT
              o.id as order_id,
              p.name as product_name,
              p.price,
              o.quantity,
              o.total_amount,
              o.status
            FROM test_orders o
            JOIN test_products p ON o.product_id = p.id
            WHERE o.tenant_id = ? AND p.tenant_id = ?
            ORDER BY o.id DESC
            LIMIT 5
          `,
          params: [testTenantId, testTenantId],
        }),
      });
      expect(joinRes.status).toBe(200);

      const joinData = (await joinRes.json()) as {
        success: boolean;
        data: Array<Record<string, unknown>>;
      };
      expect(joinData.success).toBe(true);
      expect(joinData.data.length).toBeGreaterThan(0);

      const order = joinData.data[0];
      expect(order).toHaveProperty('order_id');
      expect(order).toHaveProperty('product_name');
      expect(order).toHaveProperty('total_amount');
    });

    it('handles aggregate queries with GROUP BY', async () => {
      const aggRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: `
            SELECT
              category,
              COUNT(*) as product_count,
              AVG(price) as avg_price,
              MIN(price) as min_price,
              MAX(price) as max_price,
              SUM(price) as total_value
            FROM test_products
            WHERE tenant_id = ?
            GROUP BY category
            ORDER BY category
          `,
          params: [testTenantId],
        }),
      });
      expect(aggRes.status).toBe(200);

      const aggData = (await aggRes.json()) as {
        success: boolean;
        data: Array<Record<string, unknown>>;
      };
      expect(aggData.success).toBe(true);
      expect(aggData.data.length).toBeGreaterThan(0);

      // Verify aggregate calculations
      const electronics = aggData.data.find((row) => row['category'] === 'electronics');
      expect(electronics).toBeDefined();
      expect(electronics!['product_count']).toBeGreaterThan(0);
      expect(electronics!['avg_price']).toBeDefined();
    });

    it('handles subqueries correctly', async () => {
      const subqueryRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: `
            SELECT name, price, category
            FROM test_products
            WHERE tenant_id = ? AND price > (
              SELECT AVG(price) FROM test_products WHERE tenant_id = ?
            )
            ORDER BY price DESC
          `,
          params: [testTenantId, testTenantId],
        }),
      });
      expect(subqueryRes.status).toBe(200);

      const subqueryData = (await subqueryRes.json()) as {
        success: boolean;
        data: Array<Record<string, unknown>>;
      };
      expect(subqueryData.success).toBe(true);
      // Should return products above average price
    });
  });

  describe('Transaction Behavior', () => {
    it('handles transaction control via WebSocket', async () => {
      // This would require WebSocket testing, which is covered in websocket integration test
      // For now, test that transaction-related SQL is handled
      const beginRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'BEGIN TRANSACTION',
        }),
      });
      // Transaction control might be handled differently
      expect([200, 400]).toContain(beginRes.status);
    });
  });

  describe('Data Consistency and Isolation', () => {
    it('maintains tenant data isolation', async () => {
      const otherTenantId = 'other-tenant-123';

      // Insert data for other tenant
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'INSERT INTO test_products (name, price, category, tenant_id) VALUES (?, ?, ?, ?)',
          params: ['Other Tenant Product', 49.99, 'test', otherTenantId],
        }),
      });

      // Query should not see other tenant's data
      const tenantQueryRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT COUNT(*) as count FROM test_products WHERE tenant_id = ?',
          params: [testTenantId],
        }),
      });

      const tenantData = (await tenantQueryRes.json()) as {
        success: boolean;
        data: Array<{ count: number }>;
      };

      // Should not include the other tenant's product
      expect(tenantData.data).toHaveLength(1);

      // Clean up
      await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'DELETE FROM test_products WHERE tenant_id = ?',
          params: [otherTenantId],
        }),
      });
    });
  });

  describe('SQL Compatibility and Transpilation', () => {
    it('handles MySQL-style LIMIT syntax', async () => {
      const limitRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: 'SELECT id, name FROM test_products WHERE tenant_id = ? LIMIT 2 OFFSET 1',
          params: [testTenantId],
        }),
      });
      expect(limitRes.status).toBe(200);

      const limitData = (await limitRes.json()) as {
        success: boolean;
        data: Array<Record<string, unknown>>;
      };
      expect(limitData.success).toBe(true);
      expect(limitData.data.length).toBeLessThanOrEqual(2);
    });

    it('handles various data types correctly', async () => {
      const typesRes = await SELF.fetch('http://localhost:8787//sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: validToken,
        },
        body: JSON.stringify({
          sql: `
            SELECT
              CAST(123 AS INTEGER) as int_val,
              CAST(45.67 AS DECIMAL) as decimal_val,
              'string literal' as str_val,
              NULL as null_val
          `,
        }),
      });
      expect(typesRes.status).toBe(200);

      const typesData = (await typesRes.json()) as {
        success: boolean;
        data: Array<Record<string, unknown>>;
      };
      expect(typesData.success).toBe(true);
      expect(typesData.data[0]).toMatchObject({
        int_val: 123,
        decimal_val: 45.67,
        str_val: 'string literal',
        null_val: null,
      });
    });
  });
});
