import "server-only";

import { nanoid } from "nanoid";

export function generateOAuthState(): string {
  return nanoid(32);
}
