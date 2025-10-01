"""
Stored procedure support for WorkerSQL Python SDK
Enables calling stored procedures and functions
"""

from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Callable
import re


@dataclass
class ProcedureParameter:
    name: str
    type: str  # 'IN', 'OUT', 'INOUT'
    value: Any
    data_type: Optional[str] = None


@dataclass
class ProcedureResult:
    result_sets: List[List[Dict[str, Any]]]
    output_params: Dict[str, Any]
    affected_rows: int = 0


class StoredProcedureCaller:
    """Stored procedure caller for executing procedures and functions"""

    def __init__(self, query_fn: Callable[[str, Optional[List[Any]]], Any]):
        self.query_fn = query_fn

    def call(self, procedure_name: str, params: Optional[List[ProcedureParameter]] = None) -> ProcedureResult:
        """Call a stored procedure"""
        params = params or []
        in_params = [p for p in params if p.type in ('IN', 'INOUT')]
        out_params = [p for p in params if p.type in ('OUT', 'INOUT')]

        # Build CALL statement
        param_placeholders = ', '.join(['?' for _ in params])
        call_sql = f'CALL {procedure_name}({param_placeholders})'

        try:
            result = self.query_fn(call_sql, [p.value for p in in_params])

            # Parse result sets and output parameters
            result_sets: List[List[Dict[str, Any]]] = []
            output_params: Dict[str, Any] = {}

            if result.data and isinstance(result.data, list):
                # Handle multiple result sets
                if result.data and isinstance(result.data[0], list):
                    result_sets.extend(result.data)
                else:
                    result_sets.append(result.data)

            # Extract output parameters if available
            if hasattr(result, 'outputParams') and result.outputParams:
                output_params.update(result.outputParams)
            elif out_params:
                # Query output parameters separately
                out_param_names = ', '.join([f'@{p.name}' for p in out_params])
                out_result = self.query_fn(f'SELECT {out_param_names}')

                if out_result.data and out_result.data:
                    row = out_result.data[0]
                    for param in out_params:
                        output_params[param.name] = row.get(f'@{param.name}')

            return ProcedureResult(
                result_sets=result_sets,
                output_params=output_params,
                affected_rows=result.row_count or 0
            )
        except Exception as error:
            raise Exception(f'Failed to call stored procedure {procedure_name}: {error}')

    def call_function(self, function_name: str, params: Optional[List[Any]] = None) -> Any:
        """Call a stored function"""
        params = params or []
        param_placeholders = ', '.join(['?' for _ in params])
        sql = f'SELECT {function_name}({param_placeholders}) as result'

        result = self.query_fn(sql, params)

        if result.data and result.data:
            return result.data[0].get('result')

        return None

    def create(self, procedure_name: str, parameters: List[str], body: str):
        """Create a stored procedure"""
        param_list = ', '.join(parameters)
        sql = f"""
            CREATE PROCEDURE {procedure_name}({param_list})
            BEGIN
                {body}
            END
        """

        self.query_fn(sql)

    def drop(self, procedure_name: str):
        """Drop a stored procedure"""
        self.query_fn(f'DROP PROCEDURE IF EXISTS {procedure_name}')

    def list(self, database: Optional[str] = None) -> List[str]:
        """List all stored procedures"""
        sql = f'SHOW PROCEDURE STATUS WHERE Db = ?' if database else 'SHOW PROCEDURE STATUS'
        result = self.query_fn(sql, [database] if database else [])
        return [row['Name'] for row in (result.data or [])]

    def get_definition(self, procedure_name: str) -> str:
        """Get stored procedure definition"""
        result = self.query_fn(f'SHOW CREATE PROCEDURE {procedure_name}')

        if result.data and result.data:
            return result.data[0].get('Create Procedure', '')

        return ''


class MultiStatementExecutor:
    """Multi-statement query executor"""

    def __init__(self, query_fn: Callable[[str, Optional[List[Any]]], Any]):
        self.query_fn = query_fn

    def execute(self, statements: List[str], params: Optional[List[List[Any]]] = None) -> List[Any]:
        """Execute multiple SQL statements"""
        params = params or []
        results: List[Any] = []

        for i, stmt in enumerate(statements):
            stmt = stmt.strip()

            if not stmt:
                continue

            try:
                stmt_params = params[i] if i < len(params) else []
                result = self.query_fn(stmt, stmt_params)
                results.append(result)
            except Exception as error:
                raise Exception(f'Failed to execute statement {i + 1}: {error}')

        return results

    def execute_script(self, script: str, delimiter: str = ';') -> List[Any]:
        """Execute SQL script (multiple statements separated by semicolon)"""
        statements = self._parse_script(script, delimiter)
        return self.execute(statements)

    def _parse_script(self, script: str, delimiter: str) -> List[str]:
        """Parse SQL script into individual statements"""
        statements: List[str] = []
        current = ''
        in_string = False
        string_char = ''
        in_comment = False

        i = 0
        while i < len(script):
            char = script[i]
            next_char = script[i + 1] if i + 1 < len(script) else ''

            # Handle string literals
            if not in_comment and char in ("'", '"', '`'):
                if not in_string:
                    in_string = True
                    string_char = char
                elif char == string_char:
                    in_string = False

            # Handle comments
            if not in_string:
                if char == '-' and next_char == '-':
                    in_comment = True
                    i += 1  # Skip next char
                    i += 1
                    continue
                if in_comment and char == '\n':
                    in_comment = False
                    i += 1
                    continue
                if in_comment:
                    i += 1
                    continue

            # Handle delimiter
            if not in_string and not in_comment and script[i:i + len(delimiter)] == delimiter:
                if current.strip():
                    statements.append(current.strip())
                current = ''
                i += len(delimiter)
                continue

            current += char
            i += 1

        # Add last statement if exists
        if current.strip():
            statements.append(current.strip())

        return statements

    def execute_in_transaction(self, statements: List[str], params: Optional[List[List[Any]]] = None) -> List[Any]:
        """Execute statements in a transaction"""
        results: List[Any] = []

        try:
            # Start transaction
            self.query_fn('START TRANSACTION')

            # Execute all statements
            for i, stmt in enumerate(statements):
                stmt = stmt.strip()

                if not stmt:
                    continue

                stmt_params = params[i] if params and i < len(params) else []
                result = self.query_fn(stmt, stmt_params)
                results.append(result)

            # Commit transaction
            self.query_fn('COMMIT')
        except Exception as error:
            # Rollback on error
            try:
                self.query_fn('ROLLBACK')
            except Exception:
                # Ignore rollback errors
                pass
            raise Exception(f'Transaction failed: {error}')

        return results
