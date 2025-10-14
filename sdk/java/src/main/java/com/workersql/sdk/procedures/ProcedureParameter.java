package com.workersql.sdk.procedures;

public class ProcedureParameter {
    private final String name;
    private final ParameterType type;
    private final Object value;
    private final String dataType;

    public enum ParameterType {
        IN, OUT, INOUT
    }

    public ProcedureParameter(String name, ParameterType type, Object value, String dataType) {
        this.name = name;
        this.type = type;
        this.value = value;
        this.dataType = dataType;
    }

    public ProcedureParameter(String name, ParameterType type, Object value) {
        this(name, type, value, null);
    }

    public String getName() { return name; }
    public ParameterType getType() { return type; }
    public Object getValue() { return value; }
    public String getDataType() { return dataType; }
}
