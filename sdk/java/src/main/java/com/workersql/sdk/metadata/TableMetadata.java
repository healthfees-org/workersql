package com.workersql.sdk.metadata;

import java.util.Date;
import java.util.List;

public class TableMetadata {
    private final String name;
    private final String schema;
    private final String engine;
    private final String collation;
    private final String comment;
    private final Long rowCount;
    private final Long dataLength;
    private final Long indexLength;
    private final Long autoIncrement;
    private final Date createTime;
    private final Date updateTime;
    private final List<ColumnMetadata> columns;
    private final List<IndexMetadata> indexes;
    private final List<ForeignKeyMetadata> foreignKeys;

    public TableMetadata(String name, String schema, String engine, String collation, String comment,
                        Long rowCount, Long dataLength, Long indexLength, Long autoIncrement,
                        Date createTime, Date updateTime, List<ColumnMetadata> columns,
                        List<IndexMetadata> indexes, List<ForeignKeyMetadata> foreignKeys) {
        this.name = name;
        this.schema = schema;
        this.engine = engine;
        this.collation = collation;
        this.comment = comment;
        this.rowCount = rowCount;
        this.dataLength = dataLength;
        this.indexLength = indexLength;
        this.autoIncrement = autoIncrement;
        this.createTime = createTime;
        this.updateTime = updateTime;
        this.columns = columns;
        this.indexes = indexes;
        this.foreignKeys = foreignKeys;
    }

    public String getName() { return name; }
    public String getSchema() { return schema; }
    public String getEngine() { return engine; }
    public String getCollation() { return collation; }
    public String getComment() { return comment; }
    public Long getRowCount() { return rowCount; }
    public Long getDataLength() { return dataLength; }
    public Long getIndexLength() { return indexLength; }
    public Long getAutoIncrement() { return autoIncrement; }
    public Date getCreateTime() { return createTime; }
    public Date getUpdateTime() { return updateTime; }
    public List<ColumnMetadata> getColumns() { return columns; }
    public List<IndexMetadata> getIndexes() { return indexes; }
    public List<ForeignKeyMetadata> getForeignKeys() { return foreignKeys; }
}
