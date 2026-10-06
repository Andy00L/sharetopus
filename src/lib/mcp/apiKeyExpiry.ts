// Allowed API key lifetimes in days, shared by the keys card and the create actions.
// No "never expires" option; the UI warns on 365.
export const API_KEY_EXPIRY_DAYS_OPTIONS = [7, 30, 90, 365] as const;

export type ApiKeyExpiryDays = (typeof API_KEY_EXPIRY_DAYS_OPTIONS)[number];

export const DEFAULT_API_KEY_EXPIRY_DAYS: ApiKeyExpiryDays = 90;

/** True when the input is one of the allowed lifetimes. */
export function isValidApiKeyExpiryDays(
  candidate: number,
): candidate is ApiKeyExpiryDays {
  return API_KEY_EXPIRY_DAYS_OPTIONS.some((allowedDays) => allowedDays === candidate);
}
