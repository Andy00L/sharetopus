/**
 * Valid expiry durations (in days) for MCP API keys.
 *
 * Industry standard: short-lived credentials with mandatory rotation.
 * No "never expires" option exposed to users. 365 days is the maximum
 * and the UI must show a security warning when selected.
 *
 * Imported by both the UI (src/app/(protected)/integrations/components/
 * ApiKeysCard.tsx) and the server action (src/actions/server/mcp/
 * createApiKey.ts) so both paths validate against the same allow-list.
 */
export const API_KEY_EXPIRY_DAYS_OPTIONS = [7, 30, 90, 365] as const;

export type ApiKeyExpiryDays = (typeof API_KEY_EXPIRY_DAYS_OPTIONS)[number];

export const DEFAULT_API_KEY_EXPIRY_DAYS: ApiKeyExpiryDays = 90;

/**
 * Type guard. Returns true iff the input is exactly one of the four
 * allowed expiry durations. Used server-side to validate untrusted
 * input before computing expires_at.
 */
export function isValidApiKeyExpiryDays(
  candidate: number,
): candidate is ApiKeyExpiryDays {
  return (API_KEY_EXPIRY_DAYS_OPTIONS as readonly number[]).includes(candidate);
}
