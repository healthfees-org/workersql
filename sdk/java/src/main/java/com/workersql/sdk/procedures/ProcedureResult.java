package com.workersql.sdk.procedures;

import java.util.List;
import java.util.Map;

public class ProcedureResult {
    private final List<List<Map<String, Object>>> resultSets;
    private final Map<String, Object> outputParams;
    private final int affectedRows;

    public ProcedureResult(List<List<Map<String, Object>>> resultSets,
                          Map<String, Object> outputParams,
                          int affectedRows) {
        this.resultSets = resultSets;
        this.outputParams = outputParams;
        this.affectedRows = affectedRows;
    }

    public List<List<Map<String, Object>>> getResultSets() { return resultSets; }
    public Map<String, Object> getOutputParams() { return outputParams; }
    public int getAffectedRows() { return affectedRows; }
}
