package com.workersql.sdk.metadata;

import java.util.List;

public class DatabaseMetadata {
    private final String name;
    private final String charset;
    private final String collation;
    private final List<String> tables;

    public DatabaseMetadata(String name, String charset, String collation, List<String> tables) {
        this.name = name;
        this.charset = charset;
        this.collation = collation;
        this.tables = tables;
    }

    public String getName() { return name; }
    public String getCharset() { return charset; }
    public String getCollation() { return collation; }
    public List<String> getTables() { return tables; }
}
