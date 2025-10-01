"""
Comprehensive metadata support for WorkerSQL Python SDK
Provides detailed information about tables, columns, indexes, and constraints
"""

from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Callable, Awaitable
from datetime import datetime


@dataclass
class ColumnMetadata:
    name: str
    type: str
    nullable: bool
    default: Any
    is_primary_key: bool
    is_auto_increment: bool
    max_length: Optional[int] = None
    precision: Optional[int] = None
    scale: Optional[int] = None
    collation: Optional[str] = None
    comment: Optional[str] = None


@dataclass
class IndexMetadata:
    name: str
    columns: List[str]
    is_unique: bool
    is_primary: bool
    type: str = 'BTREE'


@dataclass
class ForeignKeyMetadata:
    name: str
    columns: List[str]
    referenced_table: str
    referenced_columns: List[str]
    on_delete: str = 'RESTRICT'
    on_update: str = 'RESTRICT'


@dataclass
class TableMetadata:
    name: str
    schema: str
    engine: str
    collation: str
    comment: Optional[str] = None
    row_count: Optional[int] = None
    data_length: Optional[int] = None
    index_length: Optional[int] = None
    auto_increment: Optional[int] = None
    create_time: Optional[datetime] = None
    update_time: Optional[datetime] = None
    columns: List[ColumnMetadata] = None
    indexes: List[IndexMetadata] = None
    foreign_keys: List[ForeignKeyMetadata] = None

    def __post_init__(self):
        if self.columns is None:
            self.columns = []
        if self.indexes is None:
            self.indexes = []
        if self.foreign_keys is None:
            self.foreign_keys = []


@dataclass
class DatabaseMetadata:
    name: str
    charset: str
    collation: str
    tables: List[str]


class MetadataProvider:
    """Metadata provider class for fetching comprehensive database metadata"""

    def __init__(self, query_fn: Callable[[str, Optional[List[Any]]], Any]):
        self.query_fn = query_fn

    def get_databases(self) -> List[DatabaseMetadata]:
        """Get list of all databases"""
        result = self.query_fn('SHOW DATABASES')
        databases = []

        for row in result.data or []:
            db_name = row['Database']
            tables = self.get_tables(db_name)
            databases.append(DatabaseMetadata(
                name=db_name,
                charset='utf8mb4',
                collation='utf8mb4_general_ci',
                tables=[t.name for t in tables]
            ))

        return databases

    def get_tables(self, database: Optional[str] = None) -> List[TableMetadata]:
        """Get list of tables in a database"""
        sql = f'SHOW TABLES FROM `{database}`' if database else 'SHOW TABLES'
        result = self.query_fn(sql)
        tables = []

        for row in result.data or []:
            table_name = list(row.values())[0]
            metadata = self.get_table_metadata(table_name, database)
            tables.append(metadata)

        return tables

    def get_table_metadata(self, table_name: str, database: Optional[str] = None) -> TableMetadata:
        """Get comprehensive metadata for a specific table"""
        full_table_name = f'`{database}`.`{table_name}`' if database else f'`{table_name}`'

        # Get column information
        columns = self.get_columns(table_name, database)

        # Get index information
        indexes = self.get_indexes(table_name, database)

        # Get foreign key information
        foreign_keys = self.get_foreign_keys(table_name, database)

        # Get table status
        status_sql = f'SHOW TABLE STATUS FROM `{database}` WHERE Name = ?' if database else 'SHOW TABLE STATUS WHERE Name = ?'
        status_result = self.query_fn(status_sql, [table_name])

        status = status_result.data[0] if status_result.data else {}

        return TableMetadata(
            name=table_name,
            schema=database or 'default',
            engine=status.get('Engine', 'InnoDB'),
            collation=status.get('Collation', 'utf8mb4_general_ci'),
            comment=status.get('Comment'),
            row_count=status.get('Rows'),
            data_length=status.get('Data_length'),
            index_length=status.get('Index_length'),
            auto_increment=status.get('Auto_increment'),
            create_time=datetime.fromisoformat(status['Create_time']) if status.get('Create_time') else None,
            update_time=datetime.fromisoformat(status['Update_time']) if status.get('Update_time') else None,
            columns=columns,
            indexes=indexes,
            foreign_keys=foreign_keys
        )

    def get_columns(self, table_name: str, database: Optional[str] = None) -> List[ColumnMetadata]:
        """Get column metadata for a table"""
        full_table_name = f'`{database}`.`{table_name}`' if database else f'`{table_name}`'
        result = self.query_fn(f'SHOW FULL COLUMNS FROM {full_table_name}')

        return [ColumnMetadata(
            name=row['Field'],
            type=row['Type'],
            nullable=row['Null'] == 'YES',
            default=row.get('Default'),
            is_primary_key=row.get('Key') == 'PRI',
            is_auto_increment='auto_increment' in (row.get('Extra') or ''),
            collation=row.get('Collation'),
            comment=row.get('Comment')
        ) for row in (result.data or [])]

    def get_indexes(self, table_name: str, database: Optional[str] = None) -> List[IndexMetadata]:
        """Get index metadata for a table"""
        full_table_name = f'`{database}`.`{table_name}`' if database else f'`{table_name}`'
        result = self.query_fn(f'SHOW INDEXES FROM {full_table_name}')

        index_map: Dict[str, IndexMetadata] = {}

        for row in result.data or []:
            index_name = row['Key_name']

            if index_name not in index_map:
                index_map[index_name] = IndexMetadata(
                    name=index_name,
                    columns=[],
                    is_unique=row.get('Non_unique') == 0,
                    is_primary=index_name == 'PRIMARY',
                    type=row.get('Index_type', 'BTREE')
                )

            index_map[index_name].columns.append(row['Column_name'])

        return list(index_map.values())

    def get_foreign_keys(self, table_name: str, database: Optional[str] = None) -> List[ForeignKeyMetadata]:
        """Get foreign key metadata for a table"""
        db_name = database or 'default'
        sql = """
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
        """

        try:
            result = self.query_fn(sql, [db_name, table_name])

            fk_map: Dict[str, ForeignKeyMetadata] = {}

            for row in result.data or []:
                fk_name = row['name']

                if fk_name not in fk_map:
                    fk_map[fk_name] = ForeignKeyMetadata(
                        name=fk_name,
                        columns=[],
                        referenced_table=row['referenced_table'],
                        referenced_columns=[],
                        on_delete=row.get('on_delete', 'RESTRICT'),
                        on_update=row.get('on_update', 'RESTRICT')
                    )

                fk_map[fk_name].columns.append(row['column_name'])
                fk_map[fk_name].referenced_columns.append(row['referenced_column'])

            return list(fk_map.values())
        except Exception:
            # If INFORMATION_SCHEMA is not available, return empty list
            return []

    def get_server_version(self) -> str:
        """Get server version information"""
        result = self.query_fn('SELECT VERSION() as version')
        return result.data[0]['version'] if result.data else 'Unknown'

    def get_server_variables(self) -> Dict[str, str]:
        """Get server variables"""
        result = self.query_fn('SHOW VARIABLES')
        return {row['Variable_name']: row['Value'] for row in (result.data or [])}

    def get_server_status(self) -> Dict[str, str]:
        """Get server status"""
        result = self.query_fn('SHOW STATUS')
        return {row['Variable_name']: row['Value'] for row in (result.data or [])}
