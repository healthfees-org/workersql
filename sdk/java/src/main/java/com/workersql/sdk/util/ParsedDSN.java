package com.workersql.sdk.util;

import java.util.Map;

/**
 * Parsed DSN components
 */
public class ParsedDSN {
    private final String protocol;
    private final String username;
    private final String password;
    private final String host;
    private final Integer port;
    private final String database;
    private final Map<String, String> params;

    public ParsedDSN(String protocol, String username, String password, String host, Integer port, String database, Map<String, String> params) {
        this.protocol = protocol;
        this.username = username;
        this.password = password;
        this.host = host;
        this.port = port;
        this.database = database;
        this.params = params;
    }

    public String getProtocol() { return protocol; }
    public String getUsername() { return username; }
    public String getPassword() { return password; }
    public String getHost() { return host; }
    public Integer getPort() { return port; }
    public String getDatabase() { return database; }
    public Map<String, String> getParams() { return params; }
}
