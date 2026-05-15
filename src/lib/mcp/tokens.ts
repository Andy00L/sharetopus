import "server-only";
import {
  generateApiKey,
  hashToken,
  isApiKeyToken,
} from "@/lib/api/tokens";

/**
 * @deprecated Use `generateApiKey('mcp')` from `@/lib/api/tokens` instead.
 * Kept as a shim for backward compatibility with existing callers.
 */
export function generateMcpApiKey() {
  return generateApiKey("mcp");
}

/**
 * @deprecated Use `isApiKeyToken(token, 'mcp')` from `@/lib/api/tokens`
 * instead. Kept as a shim for backward compatibility.
 */
export function isMcpApiKeyToken(token: string): boolean {
  return isApiKeyToken(token, "mcp");
}

/**
 * @deprecated Re-exported from `@/lib/api/tokens`. Import directly from
 * there in new code.
 */
export { hashToken };
