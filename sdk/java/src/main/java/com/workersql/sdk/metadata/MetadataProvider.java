package com.workersql.sdk.metadata;

import com.workersql.sdk.common.QueryFunction;
import com.workersql.sdk.types.QueryResponse;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Metadata provider class for fetching comprehensive database metadata
 */
public class MetadataProvider {
    private final QueryFunction queryFn;

    public MetadataProvider(QueryFunction queryFn) {
        this.queryFn = queryFn;
    }

    /**
     * Get list of all databases
     */
    public List<DatabaseMetadata> getDatabases() throws Exception {
        QueryResponse result = queryFn.execute("SHOW DATABASES", Collections.emptyList());
        List<DatabaseMetadata> databases = new ArrayList<>();

        if (result.getData() != null) {
            for (Map<String, Object> row : result.getData()) {
                String dbName = (String) row.get("Database");
                List<TableMetadata> tables = getTables(dbName);
                
                databases.add(new DatabaseMetadata(
                    dbName,
                    "utf8mb4",  // Default charset
                    "utf8mb4_general_ci",  // Default collation
                    tables.stream().map(TableMetadata::getName).collect(Collectors.toList())
                ));
            }
        }

        return databases;
    }

    /**
     * Get list of tables in a database
     */
    public List<TableMetadata> getTables(String database) throws Exception {
        String sql = database != null
            ? "SHOW TABLES FROM `" + database + "`"
            : "SHOW TABLES";

        QueryResponse result = queryFn.execute(sql, Collections.emptyList());
        List<TableMetadata> tables = new ArrayList<>();

        if (result.getData() != null) {
            for (Map<String, Object> row : result.getData()) {
                String tableName = (String) row.values().iterator().next();
                TableMetadata metadata = getTableMetadata(tableName, database);
                tables.add(metadata);
            }
        }

        return tables;
    }

    /**
     * Get comprehensive metadata for a specific table
     */
    public TableMetadata getTableMetadata(String tableName, String database) throws Exception {
        // Get column information
        List<ColumnMetadata> columns = getColumns(tableName, database);

        // Get index information
        List<IndexMetadata> indexes = getIndexes(tableName, database);

        // Get foreign key information
        List<ForeignKeyMetadata> foreignKeys = getForeignKeys(tableName, database);

        // Get table status
        String statusSql = database != null
            ? "SHOW TABLE STATUS FROM `" + database + "` WHERE Name = ?"
            : "SHOW TABLE STATUS WHERE Name = ?";

        QueryResponse statusResult = queryFn.execute(statusSql, Arrays.asList(tableName));

        Map<String, Object> status = statusResult.getData() != null && !statusResult.getData().isEmpty()
            ? statusResult.getData().get(0)
            : new HashMap<>();

        return new TableMetadata(
            tableName,
            database != null ? database : "default",
            (String) status.getOrDefault("Engine", "InnoDB"),
            (String) status.getOrDefault("Collation", "utf8mb4_general_ci"),
            (String) status.get("Comment"),
            getLongValue(status.get("Rows")),
            getLongValue(status.get("Data_length")),
            getLongValue(status.get("Index_length")),
            getLongValue(status.get("Auto_increment")),
            getDateValue(status.get("Create_time")),
            getDateValue(status.get("Update_time")),
            columns,
            indexes,
            foreignKeys
        );
    }

    /**
     * Get columns for a table
     */
    public List<ColumnMetadata> getColumns(String tableName, String database) throws Exception {
        String sql = database != null
            ? "SHOW FULL COLUMNS FROM `" + database + "`.`" + tableName + "`"
            : "SHOW FULL COLUMNS FROM `" + tableName + "`";

        QueryResponse result = queryFn.execute(sql, Collections.emptyList());
        List<ColumnMetadata> columns = new ArrayList<>();

        if (result.getData() != null) {
            for (Map<String, Object> row : result.getData()) {
                columns.add(new ColumnMetadata(
                    (String) row.get("Field"),
                    (String) row.get("Type"),
                    "YES".equalsIgnoreCase((String) row.get("Null")),
                    row.get("Default"),
                    "PRI".equalsIgnoreCase((String) row.get("Key")),
                    "auto_increment".equalsIgnoreCase((String) row.get("Extra")),
                    extractMaxLength((String) row.get("Type")),
                    extractPrecision((String) row.get("Type")),
                    extractScale((String) row.get("Type")),
                    (String) row.get("Collation"),
                    (String) row.get("Comment")
                ));
            }
        }

        return columns;
    }

    /**
     * Get indexes for a table
     */
    public List<IndexMetadata> getIndexes(String tableName, String database) throws Exception {
        String sql = database != null
            ? "SHOW INDEX FROM `" + database + "`.`" + tableName + "`"
            : "SHOW INDEX FROM `" + tableName + "`";

        QueryResponse result = queryFn.execute(sql, Collections.emptyList());
        Map<String, List<String>> indexColumns = new HashMap<>();
        Map<String, Boolean> indexUnique = new HashMap<>();
        Map<String, Boolean> indexPrimary = new HashMap<>();
        Map<String, IndexMetadata.IndexType> indexTypes = new HashMap<>();

        if (result.getData() != null) {
            for (Map<String, Object> row : result.getData()) {
                String indexName = (String) row.get("Key_name");
                String columnName = (String) row.get("Column_name");

                indexColumns.computeIfAbsent(indexName, k -> new ArrayList<>()).add(columnName);
                indexUnique.put(indexName, ((Number) row.getOrDefault("Non_unique", 1)).intValue() == 0);
                indexPrimary.put(indexName, "PRIMARY".equalsIgnoreCase(indexName));
                
                String indexType = (String) row.getOrDefault("Index_type", "BTREE");
                indexTypes.put(indexName, parseIndexType(indexType));
            }
        }

        List<IndexMetadata> indexes = new ArrayList<>();
        for (String indexName : indexColumns.keySet()) {
            indexes.add(new IndexMetadata(
                indexName,
                indexColumns.get(indexName),
                indexUnique.getOrDefault(indexName, false),
                indexPrimary.getOrDefault(indexName, false),
                indexTypes.getOrDefault(indexName, IndexMetadata.IndexType.BTREE)
            ));
        }

        return indexes;
    }

    /**
     * Get foreign keys for a table
     */
    public List<ForeignKeyMetadata> getForeignKeys(String tableName, String database) throws Exception {
        // This would typically query INFORMATION_SCHEMA
        // For simplicity, returning empty list as it requires server support
        return new ArrayList<>();
    }

    // Helper methods

    private Long getLongValue(Object value) {
        if (value == null) return null;
        if (value instanceof Number) return ((Number) value).longValue();
        try {
            return Long.parseLong(value.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private Date getDateValue(Object value) {
        if (value == null) return null;
        if (value instanceof Date) return (Date) value;
        // Could add more sophisticated date parsing here
        return null;
    }

    private Integer extractMaxLength(String type) {
        if (type == null) return null;
        // Extract length from type like VARCHAR(255)
        if (type.contains("(") && type.contains(")")) {
            try {
                String lengthStr = type.substring(type.indexOf("(") + 1, type.indexOf(")"));
                if (lengthStr.contains(",")) {
                    lengthStr = lengthStr.substring(0, lengthStr.indexOf(","));
                }
                return Integer.parseInt(lengthStr.trim());
            } catch (Exception e) {
                return null;
            }
        }
        return null;
    }

    private Integer extractPrecision(String type) {
        if (type == null) return null;
        // Extract precision from DECIMAL(10,2)
        if (type.toUpperCase().startsWith("DECIMAL") && type.contains("(") && type.contains(",")) {
            try {
                String content = type.substring(type.indexOf("(") + 1, type.indexOf(")"));
                String precision = content.split(",")[0].trim();
                return Integer.parseInt(precision);
            } catch (Exception e) {
                return null;
            }
        }
        return null;
    }

    private Integer extractScale(String type) {
        if (type == null) return null;
        // Extract scale from DECIMAL(10,2)
        if (type.toUpperCase().startsWith("DECIMAL") && type.contains("(") && type.contains(",")) {
            try {
                String content = type.substring(type.indexOf("(") + 1, type.indexOf(")"));
                String scale = content.split(",")[1].trim();
                return Integer.parseInt(scale);
            } catch (Exception e) {
                return null;
            }
        }
        return null;
    }

    private IndexMetadata.IndexType parseIndexType(String type) {
        if (type == null) return IndexMetadata.IndexType.BTREE;
        switch (type.toUpperCase()) {
            case "HASH": return IndexMetadata.IndexType.HASH;
            case "FULLTEXT": return IndexMetadata.IndexType.FULLTEXT;
            case "SPATIAL": return IndexMetadata.IndexType.SPATIAL;
            default: return IndexMetadata.IndexType.BTREE;
        }
    }
}
