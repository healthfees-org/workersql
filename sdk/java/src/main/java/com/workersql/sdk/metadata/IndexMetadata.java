package com.workersql.sdk.metadata;

import java.util.List;

public class IndexMetadata {
    private final String name;
    private final List<String> columns;
    private final boolean isUnique;
    private final boolean isPrimary;
    private final IndexType type;

    public enum IndexType {
        BTREE, HASH, FULLTEXT, SPATIAL
    }

    public IndexMetadata(String name, List<String> columns, boolean isUnique, boolean isPrimary, IndexType type) {
        this.name = name;
        this.columns = columns;
        this.isUnique = isUnique;
        this.isPrimary = isPrimary;
        this.type = type;
    }

    public String getName() { return name; }
    public List<String> getColumns() { return columns; }
    public boolean isUnique() { return isUnique; }
    public boolean isPrimary() { return isPrimary; }
    public IndexType getType() { return type; }
}
