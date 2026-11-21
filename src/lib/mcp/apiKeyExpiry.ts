export const API_KEY_EXPIRY_DAYS_OPTIONS = [7, 30, 90, 365] as const;

export type ApiKeyExpiryDays = (typeof API_KEY_EXPIRY_DAYS_OPTIONS)[number];

export const DEFAULT_API_KEY_EXPIRY_DAYS: ApiKeyExpiryDays = 90;

export function isValidApiKeyExpiryDays(
  candidate: number,
): candidate is ApiKeyExpiryDays {
  return API_KEY_EXPIRY_DAYS_OPTIONS.some((allowedDays) => allowedDays === candidate);
}
