/**
 * Comprehensive metadata support for WorkerSQL Node.js SDK
 * Provides detailed information about tables, columns, indexes, and constraints
 */

export interface ColumnMetadata {
  name: string;
  type: string;
  nullable: boolean;
  default: any;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
  collation?: string;
  comment?: string;
}

export interface IndexMetadata {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  type: 'BTREE' | 'HASH' | 'FULLTEXT' | 'SPATIAL';
}

export interface ForeignKeyMetadata {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION';
  onUpdate: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION';
}

export interface TableMetadata {
  name: string;
  schema: string;
  engine: string;
  collation: string;
  comment?: string;
  rowCount?: number;
  dataLength?: number;
  indexLength?: number;
  autoIncrement?: number;
  createTime?: Date;
  updateTime?: Date;
  columns: ColumnMetadata[];
  indexes: IndexMetadata[];
  foreignKeys: ForeignKeyMetadata[];
}

export interface DatabaseMetadata {
  name: string;
  charset: string;
  collation: string;
  tables: string[];
}

/**
 * Metadata provider class for fetching comprehensive database metadata
 */
export class MetadataProvider {
  constructor(private queryFn: (sql: string, params?: any[]) => Promise<any>) {}

  /**
   * Get list of all databases
   */
  async getDatabases(): Promise<DatabaseMetadata[]> {
    const result = await this.queryFn('SHOW DATABASES');
    const databases: DatabaseMetadata[] = [];
    
    for (const row of result.data || []) {
      const dbName = row.Database;
      const tables = await this.getTables(dbName);
      databases.push({
        name: dbName,
        charset: 'utf8mb4', // Default, can be queried
        collation: 'utf8mb4_general_ci',
        tables: tables.map(t => t.name)
      });
    }
    
    return databases;
  }

  /**
   * Get list of tables in a database
   */
  async getTables(database?: string): Promise<TableMetadata[]> {
    const sql = database 
      ? `SHOW TABLES FROM \`${database}\``
      : 'SHOW TABLES';
    
    const result = await this.queryFn(sql);
    const tables: TableMetadata[] = [];
    
    for (const row of result.data || []) {
      const tableName = Object.values(row)[0] as string;
      const metadata = await this.getTableMetadata(tableName, database);
      tables.push(metadata);
    }
    
    return tables;
  }

  /**
   * Get comprehensive metadata for a specific table
   */
  async getTableMetadata(tableName: string, database?: string): Promise<TableMetadata> {
    const fullTableName = database ? `\`${database}\`.\`${tableName}\`` : `\`${tableName}\``;
    
    // Get column information
    const columns = await this.getColumns(tableName, database);
    
    // Get index information
    const indexes = await this.getIndexes(tableName, database);
    
    // Get foreign key information
    const foreignKeys = await this.getForeignKeys(tableName, database);
    
    // Get table status
    const statusResult = await this.queryFn(
      database 
        ? `SHOW TABLE STATUS FROM \`${database}\` WHERE Name = ?`
        : `SHOW TABLE STATUS WHERE Name = ?`,
      [tableName]
    );
    
    const status = statusResult.data?.[0] || {};
    
    return {
      name: tableName,
      schema: database || 'default',
      engine: status.Engine || 'InnoDB',
      collation: status.Collation || 'utf8mb4_general_ci',
      comment: status.Comment,
      rowCount: status.Rows,
      dataLength: status.Data_length,
      indexLength: status.Index_length,
      autoIncrement: status.Auto_increment,
      createTime: status.Create_time ? new Date(status.Create_time) : undefined,
      updateTime: status.Update_time ? new Date(status.Update_time) : undefined,
      columns,
      indexes,
      foreignKeys
    };
  }

  /**
   * Get column metadata for a table
   */
  async getColumns(tableName: string, database?: string): Promise<ColumnMetadata[]> {
    const fullTableName = database ? `\`${database}\`.\`${tableName}\`` : `\`${tableName}\``;
    const result = await this.queryFn(`SHOW FULL COLUMNS FROM ${fullTableName}`);
    
    return (result.data || []).map((row: any) => ({
      name: row.Field,
      type: row.Type,
      nullable: row.Null === 'YES',
      default: row.Default,
      isPrimaryKey: row.Key === 'PRI',
      isAutoIncrement: row.Extra?.includes('auto_increment') || false,
      collation: row.Collation,
      comment: row.Comment
    }));
  }

  /**
   * Get index metadata for a table
   */
  async getIndexes(tableName: string, database?: string): Promise<IndexMetadata[]> {
    const fullTableName = database ? `\`${database}\`.\`${tableName}\`` : `\`${tableName}\``;
    const result = await this.queryFn(`SHOW INDEXES FROM ${fullTableName}`);
    
    const indexMap = new Map<string, IndexMetadata>();
    
    for (const row of result.data || []) {
      const indexName = row.Key_name;
      
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, {
          name: indexName,
          columns: [],
          isUnique: row.Non_unique === 0,
          isPrimary: indexName === 'PRIMARY',
          type: row.Index_type || 'BTREE'
        });
      }
      
      indexMap.get(indexName)!.columns.push(row.Column_name);
    }
    
    return Array.from(indexMap.values());
  }

  /**
   * Get foreign key metadata for a table
   */
  async getForeignKeys(tableName: string, database?: string): Promise<ForeignKeyMetadata[]> {
    const dbName = database || 'default';
    const sql = `
      SELECT 
        CONSTRAINT_NAME as name,
        COLUMN_NAME as column_name,
        REFERENCED_TABLE_NAME as referenced_table,
        REFERENCED_COLUMN_NAME as referenced_column,
        DELETE_RULE as on_delete,
        UPDATE_RULE as on_update
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION
    `;
    
    try {
      const result = await this.queryFn(sql, [dbName, tableName]);
      
      const fkMap = new Map<string, ForeignKeyMetadata>();
      
      for (const row of result.data || []) {
        const fkName = row.name;
        
        if (!fkMap.has(fkName)) {
          fkMap.set(fkName, {
            name: fkName,
            columns: [],
            referencedTable: row.referenced_table,
            referencedColumns: [],
            onDelete: row.on_delete || 'RESTRICT',
            onUpdate: row.on_update || 'RESTRICT'
          });
        }
        
        fkMap.get(fkName)!.columns.push(row.column_name);
        fkMap.get(fkName)!.referencedColumns.push(row.referenced_column);
      }
      
      return Array.from(fkMap.values());
    } catch (error) {
      // If INFORMATION_SCHEMA is not available, return empty array
      return [];
    }
  }

  /**
   * Get server version information
   */
  async getServerVersion(): Promise<string> {
    const result = await this.queryFn('SELECT VERSION() as version');
    return result.data?.[0]?.version || 'Unknown';
  }

  /**
   * Get server variables
   */
  async getServerVariables(): Promise<Record<string, string>> {
    const result = await this.queryFn('SHOW VARIABLES');
    const variables: Record<string, string> = {};
    
    for (const row of result.data || []) {
      variables[row.Variable_name] = row.Value;
    }
    
    return variables;
  }

  /**
   * Get server status
   */
  async getServerStatus(): Promise<Record<string, string>> {
    const result = await this.queryFn('SHOW STATUS');
    const status: Record<string, string> = {};
    
    for (const row of result.data || []) {
      status[row.Variable_name] = row.Value;
    }
    
    return status;
  }
}
