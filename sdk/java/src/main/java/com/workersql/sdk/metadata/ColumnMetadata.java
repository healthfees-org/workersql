package com.workersql.sdk.metadata;

public class ColumnMetadata {
    private final String name;
    private final String type;
    private final boolean nullable;
    private final Object defaultValue;
    private final boolean isPrimaryKey;
    private final boolean isAutoIncrement;
    private final Integer maxLength;
    private final Integer precision;
    private final Integer scale;
    private final String collation;
    private final String comment;

    public ColumnMetadata(String name, String type, boolean nullable, Object defaultValue,
                         boolean isPrimaryKey, boolean isAutoIncrement, Integer maxLength,
                         Integer precision, Integer scale, String collation, String comment) {
        this.name = name;
        this.type = type;
        this.nullable = nullable;
        this.defaultValue = defaultValue;
        this.isPrimaryKey = isPrimaryKey;
        this.isAutoIncrement = isAutoIncrement;
        this.maxLength = maxLength;
        this.precision = precision;
        this.scale = scale;
        this.collation = collation;
        this.comment = comment;
    }

    public String getName() { return name; }
    public String getType() { return type; }
    public boolean isNullable() { return nullable; }
    public Object getDefaultValue() { return defaultValue; }
    public boolean isPrimaryKey() { return isPrimaryKey; }
    public boolean isAutoIncrement() { return isAutoIncrement; }
    public Integer getMaxLength() { return maxLength; }
    public Integer getPrecision() { return precision; }
    public Integer getScale() { return scale; }
    public String getCollation() { return collation; }
    public String getComment() { return comment; }
}
