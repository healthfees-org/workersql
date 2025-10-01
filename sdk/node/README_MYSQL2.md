# mysql2 Compatibility for Node.js SDK

This document describes the mysql2-compatible interface for the WorkerSQL Node.js SDK, enabling drop-in replacement for TypeORM, Sequelize, Knex, and other Node.js ORMs.

## Overview

The WorkerSQL Node.js SDK now includes a mysql2-compatible interface:

- **Module**: `@workersql/node-sdk/mysql2-compat`
- **Compatible with**: mysql2/promise API
- **Features**: Connection pooling, prepared statements, transactions

## Installation

```typescript
import { createConnection, createPool } from '@workersql/node-sdk/mysql2-compat';

// Create single connection
const connection = createConnection({
  host: 'api.workersql.com',
  user: 'myuser',
  password: 'mypass',
  database: 'mydb',
  apiKey: 'your-api-key'
});

// Or use DSN
const connection = createConnection({
  dsn: 'workersql://user:pass@api.workersql.com/mydb?apiKey=abc123'
});
```

## Usage with TypeORM

Update `ormconfig.json`:

```json
{
  "type": "workersql",
  "host": "api.workersql.com",
  "username": "myuser",
  "password": "mypass",
  "database": "mydb",
  "extra": {
    "apiKey": "your-api-key"
  }
}
```

Create custom TypeORM driver:

```typescript
import { createConnection } from '@workersql/node-sdk/mysql2-compat';
import { Driver } from 'typeorm/driver/Driver';

export class WorkerSQLDriver extends Driver {
  async connect(): Promise<void> {
    this.connection = createConnection({
      host: this.options.host,
      user: this.options.username,
      password: this.options.password,
      database: this.options.database,
      apiKey: this.options.extra?.apiKey
    });
  }
  
  // Implement other Driver methods...
}
```

## Usage with Sequelize

```typescript
import { Sequelize } from 'sequelize';
import { createPool } from '@workersql/node-sdk/mysql2-compat';

const pool = createPool({
  host: 'api.workersql.com',
  user: 'myuser',
  password: 'mypass',
  database: 'mydb',
  apiKey: 'your-api-key',
  connectionLimit: 10
});

const sequelize = new Sequelize({
  dialect: 'mysql',
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  dialectModule: {
    createPool: () => pool
  }
});

// Define models as normal
const User = sequelize.define('User', {
  username: Sequelize.STRING,
  email: Sequelize.STRING
});

// Use as normal
const users = await User.findAll();
```

## Usage with Knex

```typescript
import knex from 'knex';

const db = knex({
  client: 'mysql2',
  connection: {
    host: 'api.workersql.com',
    user: 'myuser',
    password: 'mypass',
    database: 'mydb',
    apiKey: 'your-api-key'
  }
});

// Use as normal
const users = await db('users').where('id', 1);
```

## Connection API

### Connection Class

```typescript
class Connection {
  async query(sql: string, values?: any[]): Promise<[any, any]>
  async execute(sql: string, values?: any[]): Promise<[any, any]>
  async beginTransaction(): Promise<void>
  async commit(): Promise<void>
  async rollback(): Promise<void>
  async end(): Promise<void>
  async destroy(): Promise<void>
}
```

### Pool Class

```typescript
class Pool extends Connection {
  async getConnection(): Promise<Connection>
  async releaseConnection(connection: Connection): Promise<void>
}
```

### Factory Functions

```typescript
function createConnection(options: ConnectionOptions): Connection
function createPool(options: PoolOptions): Pool
```

## Connection Options

```typescript
interface ConnectionOptions {
  host?: string;           // API host
  port?: number;           // API port
  user?: string;           // Username
  password?: string;       // Password
  database?: string;       // Database name
  apiKey?: string;         // API key for authentication
  ssl?: boolean;           // Enable SSL (default: true)
  timeout?: number;        // Query timeout in ms
  dsn?: string;            // Or use DSN directly
}

interface PoolOptions extends ConnectionOptions {
  connectionLimit?: number;   // Max connections (default: 10)
  waitForConnections?: boolean;  // Wait for available connection
  queueLimit?: number;        // Max queued connection requests
}
```

## Query Execution

### Simple Query

```typescript
const [rows, fields] = await connection.query('SELECT * FROM users WHERE id = ?', [1]);
console.log(rows);
```

### Prepared Statement

```typescript
const [rows] = await connection.execute(
  'SELECT * FROM users WHERE email = ? AND status = ?',
  ['user@example.com', 'active']
);
```

### Transaction

```typescript
await connection.beginTransaction();
try {
  await connection.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1]);
  await connection.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2]);
  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
}
```

## Pool Usage

```typescript
const pool = createPool({
  host: 'api.workersql.com',
  user: 'myuser',
  password: 'mypass',
  database: 'mydb',
  apiKey: 'your-api-key',
  connectionLimit: 10
});

// Automatic connection management
const [rows] = await pool.query('SELECT * FROM users');

// Manual connection management
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  await connection.query('INSERT INTO users (name) VALUES (?)', ['John']);
  await connection.commit();
} finally {
  await pool.releaseConnection(connection);
}

// Close pool
await pool.end();
```

## Usage with Express.js

```typescript
import express from 'express';
import { createPool } from '@workersql/node-sdk/mysql2-compat';

const app = express();
const pool = createPool({
  host: 'api.workersql.com',
  user: 'myuser',
  password: 'mypass',
  database: 'mydb',
  apiKey: process.env.WORKERSQL_API_KEY,
  connectionLimit: 10
});

app.get('/users/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/users', async (req, res) => {
  const { username, email } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO users (username, email) VALUES (?, ?)',
      [username, email]
    );
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

## Usage with NestJS

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: 'api.workersql.com',
      username: 'myuser',
      password: 'mypass',
      database: 'mydb',
      extra: {
        apiKey: process.env.WORKERSQL_API_KEY
      },
      entities: [User],
      synchronize: false,
    }),
  ],
})
export class AppModule {}

// Use repository pattern as normal
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async findOne(id: number): Promise<User> {
    return this.usersRepository.findOne({ where: { id } });
  }
}
```

## Error Handling

```typescript
import { Connection } from '@workersql/node-sdk/mysql2-compat';

try {
  const [rows] = await connection.query('SELECT * FROM users WHERE id = ?', [1]);
} catch (error) {
  if (error.code === 'CONNECTION_ERROR') {
    // Handle connection error
  } else if (error.code === 'INVALID_QUERY') {
    // Handle query error
  } else {
    // Handle other errors
  }
}
```

## Limitations

1. **No Native Protocol**: Uses HTTP API instead of MySQL wire protocol
2. **Batch Transactions**: Transactions queued via WebSocket
3. **Streaming**: Result streaming not yet supported
4. **Multi-Statement**: Not supported in single query
5. **Metadata**: Limited result metadata compared to mysql2

## Performance Considerations

- **Connection Pooling**: Managed by underlying WorkerSQLClient
- **Edge Caching**: Queries benefit from edge cache
- **Transaction Overhead**: WebSocket sticky sessions minimize latency
- **Prepared Statements**: Client-side statement caching

## Testing

Run mysql2 compatibility tests:

```bash
npm test -- mysql2-compat
```

## Migration from mysql2

### Before (mysql2)

```typescript
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'mydb'
});

const [rows] = await pool.query('SELECT * FROM users');
```

### After (WorkerSQL)

```typescript
import { createPool } from '@workersql/node-sdk/mysql2-compat';

const pool = createPool({
  host: 'api.workersql.com',
  user: 'root',
  password: 'password',
  database: 'mydb',
  apiKey: 'your-api-key'
});

const [rows] = await pool.query('SELECT * FROM users');
```

## Type Definitions

Full TypeScript support with type definitions:

```typescript
import type { Connection, Pool, ConnectionOptions, PoolOptions } from '@workersql/node-sdk/mysql2-compat';
```

## Future Enhancements

- [ ] Result streaming support
- [ ] Enhanced connection pool statistics
- [ ] Query caching improvements
- [ ] Multi-statement query support
- [ ] Binary protocol support

## Support

For issues or questions:
- GitHub: https://github.com/healthfees-org/workersql
- Documentation: /docs/architecture/010-sdk-integration.md
