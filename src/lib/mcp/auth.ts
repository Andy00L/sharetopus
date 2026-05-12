// Re-export shim for backward compatibility. The resolver was refactored
// into src/lib/mcp/auth/ in Phase 1 (2026-05-11). Existing imports of
// `resolveMcpPrincipal` and `McpPrincipal` from `@/lib/mcp/auth` continue
// to work via this shim.
//
// New code should import from `@/lib/mcp/auth/resolve` or
// `@/lib/mcp/auth/types`.

export { resolveMcpPrincipal } from "./auth/resolve";
export type { ResolveHints } from "./auth/resolve";
export type { McpPrincipal, McpPrincipalKind } from "./auth/types";
export { assertExhaustiveKind } from "./auth/types";
