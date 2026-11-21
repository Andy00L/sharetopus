import "server-only";

export const MCP_ROUTE_RATE_LIMIT = { requests: 1000, windowSeconds: 60 } as const;

export const MCP_TOOL_CALL_RATE_LIMIT = { calls: 100, windowSeconds: 60 } as const;
