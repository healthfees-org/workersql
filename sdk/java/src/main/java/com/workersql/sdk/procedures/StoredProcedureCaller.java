package com.workersql.sdk.procedures;

import com.workersql.sdk.common.QueryFunction;
import com.workersql.sdk.types.QueryResponse;

import java.util.*;

public class StoredProcedureCaller {
    private final QueryFunction queryFn;

    public StoredProcedureCaller(QueryFunction queryFn) {
        this.queryFn = queryFn;
    }

    public ProcedureResult call(String procedureName, List<ProcedureParameter> params) throws Exception {
        List<ProcedureParameter> inParams = new ArrayList<>();
        List<ProcedureParameter> outParams = new ArrayList<>();

        for (ProcedureParameter param : params) {
            if (param.getType() == ProcedureParameter.ParameterType.IN ||
                param.getType() == ProcedureParameter.ParameterType.INOUT) {
                inParams.add(param);
            }
            if (param.getType() == ProcedureParameter.ParameterType.OUT ||
                param.getType() == ProcedureParameter.ParameterType.INOUT) {
                outParams.add(param);
            }
        }

        StringBuilder callSql = new StringBuilder("CALL ").append(procedureName).append("(");
        for (int i = 0; i < params.size(); i++) {
            if (i > 0) callSql.append(", ");
            callSql.append("?");
        }
        callSql.append(")");

        List<Object> paramValues = new ArrayList<>();
        for (ProcedureParameter param : inParams) {
            paramValues.add(param.getValue());
        }

        try {
            QueryResponse result = queryFn.execute(callSql.toString(), paramValues);

            List<List<Map<String, Object>>> resultSets = new ArrayList<>();
            Map<String, Object> outputParams = new HashMap<>();

            if (result.getData() != null) {
                resultSets.add(result.getData());
            }

            if (!outParams.isEmpty()) {
                StringBuilder selectOut = new StringBuilder("SELECT ");
                for (int i = 0; i < outParams.size(); i++) {
                    if (i > 0) selectOut.append(", ");
                    selectOut.append("@").append(outParams.get(i).getName());
                }

                QueryResponse outResult = queryFn.execute(selectOut.toString(), Collections.emptyList());

                if (outResult.getData() != null && !outResult.getData().isEmpty()) {
                    Map<String, Object> row = outResult.getData().get(0);
                    for (ProcedureParameter param : outParams) {
                        outputParams.put(param.getName(), row.get("@" + param.getName()));
                    }
                }
            }

            return new ProcedureResult(
                resultSets,
                outputParams,
                result.getRowCount() != null ? result.getRowCount() : 0
            );
        } catch (Exception e) {
            throw new Exception("Failed to call stored procedure " + procedureName + ": " + e.getMessage(), e);
        }
    }

    public Object callFunction(String functionName, List<Object> params) throws Exception {
        StringBuilder sql = new StringBuilder("SELECT ").append(functionName).append("(");
        for (int i = 0; i < params.size(); i++) {
            if (i > 0) sql.append(", ");
            sql.append("?");
        }
        sql.append(") as result");

        QueryResponse result = queryFn.execute(sql.toString(), params);

        if (result.getData() != null && !result.getData().isEmpty()) {
            return result.getData().get(0).get("result");
        }

        return null;
    }

    public void create(String procedureName, List<String> parameters, String body) throws Exception {
        String paramList = String.join(", ", parameters);
        String sql = String.format(
            "CREATE PROCEDURE %s(%s)\nBEGIN\n%s\nEND",
            procedureName, paramList, body
        );

        queryFn.execute(sql, Collections.emptyList());
    }

    public void drop(String procedureName) throws Exception {
        queryFn.execute("DROP PROCEDURE IF EXISTS " + procedureName, Collections.emptyList());
    }

    public List<String> list(String database) throws Exception {
        String sql = database != null
            ? "SHOW PROCEDURE STATUS WHERE Db = ?"
            : "SHOW PROCEDURE STATUS";

        List<Object> params = database != null ? Arrays.asList(database) : Collections.emptyList();
        QueryResponse result = queryFn.execute(sql, params);

        List<String> procedures = new ArrayList<>();
        if (result.getData() != null) {
            for (Map<String, Object> row : result.getData()) {
                procedures.add((String) row.get("Name"));
            }
        }

        return procedures;
    }

    public String getDefinition(String procedureName) throws Exception {
        QueryResponse result = queryFn.execute("SHOW CREATE PROCEDURE " + procedureName, Collections.emptyList());

        if (result.getData() != null && !result.getData().isEmpty()) {
            Object definition = result.getData().get(0).get("Create Procedure");
            return definition != null ? definition.toString() : "";
        }

        return "";
    }
}
