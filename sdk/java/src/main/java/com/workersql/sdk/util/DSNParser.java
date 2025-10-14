package com.workersql.sdk.util;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * DSN Parser for WorkerSQL
 * Parses connection strings in the format:
 * workersql://[username[:password]@]host[:port][/database][?param1=value1&param2=value2]
 */
public class DSNParser {
    private static final Pattern DSN_PATTERN = Pattern.compile(
        "^([a-z]+)://(?:([^:@]+)(?::([^@]+))?@)?([^/:?]+)(?::(\\d+))?(?:/([^?]+))?(?:\\?(.+))?$",
        Pattern.CASE_INSENSITIVE
    );

    /**
     * Parse a WorkerSQL DSN string
     * @param dsn Connection string to parse
     * @return Parsed DSN components
     */
    public static ParsedDSN parse(String dsn) {
        if (dsn == null || dsn.isEmpty()) {
            throw new IllegalArgumentException("DSN must be a non-empty string");
        }

        Matcher matcher = DSN_PATTERN.matcher(dsn);
        if (!matcher.matches()) {
            throw new IllegalArgumentException("Invalid DSN format: " + dsn);
        }

        String protocol = matcher.group(1);
        String username = matcher.group(2);
        String password = matcher.group(3);
        String host = matcher.group(4);
        String portStr = matcher.group(5);
        String database = matcher.group(6);
        String queryString = matcher.group(7);

        // Validate protocol
        if (protocol == null || !protocol.equalsIgnoreCase("workersql")) {
            throw new IllegalArgumentException("Invalid protocol: " + protocol + ". Expected 'workersql'");
        }

        if (host == null || host.isEmpty()) {
            throw new IllegalArgumentException("Host is required in DSN");
        }

        // Parse port
        Integer port = null;
        if (portStr != null) {
            try {
                port = Integer.parseInt(portStr);
                if (port < 1 || port > 65535) {
                    throw new IllegalArgumentException("Invalid port: " + portStr);
                }
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("Invalid port: " + portStr);
            }
        }

        // Parse query parameters
        Map<String, String> params = new HashMap<>();
        if (queryString != null && !queryString.isEmpty()) {
            String[] pairs = queryString.split("&");
            for (String pair : pairs) {
                int idx = pair.indexOf('=');
                if (idx > 0) {
                    String key = urlDecode(pair.substring(0, idx));
                    String value = idx < pair.length() - 1 ? urlDecode(pair.substring(idx + 1)) : "";
                    params.put(key, value);
                }
            }
        }

        return new ParsedDSN(
            protocol,
            username != null ? urlDecode(username) : null,
            password != null ? urlDecode(password) : null,
            urlDecode(host),
            port,
            database != null ? urlDecode(database) : null,
            params
        );
    }

    /**
     * Convert parsed DSN back to string format
     * @param parsed Parsed DSN components
     * @return DSN string
     */
    public static String stringify(ParsedDSN parsed) {
        StringBuilder dsn = new StringBuilder(parsed.getProtocol()).append("://");

        if (parsed.getUsername() != null) {
            dsn.append(urlEncode(parsed.getUsername()));
            if (parsed.getPassword() != null) {
                dsn.append(":").append(urlEncode(parsed.getPassword()));
            }
            dsn.append("@");
        }

        dsn.append(urlEncode(parsed.getHost()));

        if (parsed.getPort() != null) {
            dsn.append(":").append(parsed.getPort());
        }

        if (parsed.getDatabase() != null) {
            dsn.append("/").append(urlEncode(parsed.getDatabase()));
        }

        if (!parsed.getParams().isEmpty()) {
            dsn.append("?");
            boolean first = true;
            for (Map.Entry<String, String> entry : parsed.getParams().entrySet()) {
                if (!first) dsn.append("&");
                dsn.append(urlEncode(entry.getKey())).append("=").append(urlEncode(entry.getValue()));
                first = false;
            }
        }

        return dsn.toString();
    }

    /**
     * Extract API endpoint from DSN parameters or construct from host
     * @param parsed Parsed DSN components
     * @return API endpoint URL
     */
    public static String getApiEndpoint(ParsedDSN parsed) {
        // Check if apiEndpoint is specified in params
        if (parsed.getParams().containsKey("apiEndpoint")) {
            return parsed.getParams().get("apiEndpoint");
        }

        // Construct from host
        String protocol = "false".equalsIgnoreCase(parsed.getParams().get("ssl")) ? "http" : "https";
        String port = parsed.getPort() != null ? ":" + parsed.getPort() : "";
        return protocol + "://" + parsed.getHost() + port + "/v1";
    }

    private static String urlDecode(String str) {
        try {
            return URLDecoder.decode(str, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new RuntimeException("UTF-8 encoding not supported", e);
        }
    }

    private static String urlEncode(String str) {
        try {
            return URLEncoder.encode(str, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new RuntimeException("UTF-8 encoding not supported", e);
        }
    }
}
