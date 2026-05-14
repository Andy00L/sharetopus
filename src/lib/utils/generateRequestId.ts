import "server-only";

/**
 * Generates a unique request ID for log tracing across the full
 * request lifecycle (web entry, core action, Inngest event, worker).
 * Used in console logs as `[req=<uuid>]`.
 *
 * Uses crypto.randomUUID() which is available in both Node.js
 * runtimes (server actions, route handlers) and Edge runtimes
 * via the Web Crypto API.
 *
 * Pure function. Never throws.
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}
