import { randomBytes } from "node:crypto";

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}
