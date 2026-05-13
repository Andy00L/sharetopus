import "server-only";

import { nanoid } from "nanoid";

/**
 * Generate a fresh OAuth state string. 32-char nanoid (URL-safe alphabet).
 *
 * The state is stored in social_connections.oauth_state (UNIQUE constraint).
 * No additional encoding: the social_connections row maps state -> connectionId.
 *
 * State lookup happens in handleOAuthCallback.
 */
export function generateOAuthState(): string {
  return nanoid(32);
}
