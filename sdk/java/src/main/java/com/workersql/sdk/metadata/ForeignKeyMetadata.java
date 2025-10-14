package com.workersql.sdk.metadata;

import java.util.List;

public class ForeignKeyMetadata {
    private final String name;
    private final List<String> columns;
    private final String referencedTable;
    private final List<String> referencedColumns;
    private final ReferentialAction onDelete;
    private final ReferentialAction onUpdate;

    public enum ReferentialAction {
        RESTRICT, CASCADE, SET_NULL, NO_ACTION
    }

    public ForeignKeyMetadata(String name, List<String> columns, String referencedTable,
                             List<String> referencedColumns, ReferentialAction onDelete, ReferentialAction onUpdate) {
        this.name = name;
        this.columns = columns;
        this.referencedTable = referencedTable;
        this.referencedColumns = referencedColumns;
        this.onDelete = onDelete;
        this.onUpdate = onUpdate;
    }

    public String getName() { return name; }
    public List<String> getColumns() { return columns; }
    public String getReferencedTable() { return referencedTable; }
    public List<String> getReferencedColumns() { return referencedColumns; }
    public ReferentialAction getOnDelete() { return onDelete; }
    public ReferentialAction getOnUpdate() { return onUpdate; }
}
