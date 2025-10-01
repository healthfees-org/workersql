/**
 * Stored procedure support for WorkerSQL Node.js SDK
 * Enables calling stored procedures and functions
 */

export interface ProcedureParameter {
  name: string;
  type: 'IN' | 'OUT' | 'INOUT';
  value: any;
  dataType?: string;
}

export interface ProcedureResult {
  resultSets: any[][];
  outputParams: Record<string, any>;
  affectedRows: number;
}

/**
 * Stored procedure caller
 */
export class StoredProcedureCaller {
  constructor(private queryFn: (sql: string, params?: any[]) => Promise<any>) {}

  /**
   * Call a stored procedure
   */
  async call(procedureName: string, params: ProcedureParameter[] = []): Promise<ProcedureResult> {
    const inParams = params.filter(p => p.type === 'IN' || p.type === 'INOUT');
    const outParams = params.filter(p => p.type === 'OUT' || p.type === 'INOUT');

    // Build CALL statement
    const paramPlaceholders = params.map(() => '?').join(', ');
    const callSql = `CALL ${procedureName}(${paramPlaceholders})`;

    try {
      const result = await this.queryFn(callSql, inParams.map(p => p.value));

      // Parse result sets and output parameters
      const resultSets: any[][] = [];
      const outputParams: Record<string, any> = {};

      if (Array.isArray(result.data)) {
        // Handle multiple result sets
        if (result.data.length > 0 && Array.isArray(result.data[0])) {
          resultSets.push(...result.data);
        } else {
          resultSets.push(result.data);
        }
      }

      // Extract output parameters if available
      if (result.outputParams) {
        Object.assign(outputParams, result.outputParams);
      } else if (outParams.length > 0) {
        // Query output parameters separately
        const outParamNames = outParams.map(p => `@${p.name}`).join(', ');
        const outResult = await this.queryFn(`SELECT ${outParamNames}`);

        if (outResult.data && outResult.data.length > 0) {
          const row = outResult.data[0];
          for (const param of outParams) {
            outputParams[param.name] = row[`@${param.name}`];
          }
        }
      }

      return {
        resultSets,
        outputParams,
        affectedRows: result.rowCount || 0
      };
    } catch (error) {
      throw new Error(`Failed to call stored procedure ${procedureName}: ${error}`);
    }
  }

  /**
   * Call a stored function
   */
  async callFunction(functionName: string, params: any[] = []): Promise<any> {
    const paramPlaceholders = params.map(() => '?').join(', ');
    const sql = `SELECT ${functionName}(${paramPlaceholders}) as result`;

    const result = await this.queryFn(sql, params);

    if (result.data && result.data.length > 0) {
      return result.data[0].result;
    }

    return null;
  }

  /**
   * Create a stored procedure
   */
  async create(procedureName: string, parameters: string[], body: string): Promise<void> {
    const paramList = parameters.join(', ');
    const sql = `
      CREATE PROCEDURE ${procedureName}(${paramList})
      BEGIN
        ${body}
      END
    `;

    await this.queryFn(sql);
  }

  /**
   * Drop a stored procedure
   */
  async drop(procedureName: string): Promise<void> {
    await this.queryFn(`DROP PROCEDURE IF EXISTS ${procedureName}`);
  }

  /**
   * List all stored procedures
   */
  async list(database?: string): Promise<string[]> {
    const sql = database
      ? `SHOW PROCEDURE STATUS WHERE Db = ?`
      : 'SHOW PROCEDURE STATUS';

    const result = await this.queryFn(sql, database ? [database] : []);
    return (result.data || []).map((row: any) => row.Name);
  }

  /**
   * Get stored procedure definition
   */
  async getDefinition(procedureName: string): Promise<string> {
    const result = await this.queryFn(`SHOW CREATE PROCEDURE ${procedureName}`);

    if (result.data && result.data.length > 0) {
      return result.data[0]['Create Procedure'] || '';
    }

    return '';
  }
}

/**
 * Multi-statement query executor
 */
export class MultiStatementExecutor {
  constructor(private queryFn: (sql: string, params?: any[]) => Promise<any>) {}

  /**
   * Execute multiple SQL statements
   */
  async execute(statements: string[], params: any[][] = []): Promise<any[]> {
    const results: any[] = [];

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();

      if (!stmt) {
        continue;
      }

      try {
        const stmtParams = params[i] || [];
        const result = await this.queryFn(stmt, stmtParams);
        results.push(result);
      } catch (error) {
        throw new Error(`Failed to execute statement ${i + 1}: ${error}`);
      }
    }

    return results;
  }

  /**
   * Execute SQL script (multiple statements separated by semicolon)
   */
  async executeScript(script: string, delimiter: string = ';'): Promise<any[]> {
    const statements = this.parseScript(script, delimiter);
    return this.execute(statements);
  }

  /**
   * Parse SQL script into individual statements
   */
  private parseScript(script: string, delimiter: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let inComment = false;

    for (let i = 0; i < script.length; i++) {
      const char = script[i];
      const nextChar = script[i + 1];

      // Handle string literals
      if (!inComment && (char === "'" || char === '"' || char === '`')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
      }

      // Handle comments
      if (!inString) {
        if (char === '-' && nextChar === '-') {
          inComment = true;
          i++; // Skip next char
          continue;
        }
        if (inComment && char === '\n') {
          inComment = false;
          continue;
        }
        if (inComment) {
          continue;
        }
      }

      // Handle delimiter
      if (!inString && !inComment && script.substr(i, delimiter.length) === delimiter) {
        if (current.trim()) {
          statements.push(current.trim());
        }
        current = '';
        i += delimiter.length - 1;
        continue;
      }

      current += char;
    }

    // Add last statement if exists
    if (current.trim()) {
      statements.push(current.trim());
    }

    return statements;
  }

  /**
   * Execute statements in a transaction
   */
  async executeInTransaction(statements: string[], params: any[][] = []): Promise<any[]> {
    const results: any[] = [];

    try {
      // Start transaction
      await this.queryFn('START TRANSACTION');

      // Execute all statements
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i].trim();

        if (!stmt) {
          continue;
        }

        const stmtParams = params[i] || [];
        const result = await this.queryFn(stmt, stmtParams);
        results.push(result);
      }

      // Commit transaction
      await this.queryFn('COMMIT');
    } catch (error) {
      // Rollback on error
      try {
        await this.queryFn('ROLLBACK');
      } catch (rollbackError) {
        // Ignore rollback errors
      }
      throw new Error(`Transaction failed: ${error}`);
    }

    return results;
  }
}
