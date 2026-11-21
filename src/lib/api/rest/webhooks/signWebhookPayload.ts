import { createHmac } from "node:crypto";

export function signWebhookPayload(
  payloadString: string,
  secret: string,
): string {
  return createHmac("sha256", secret).update(payloadString).digest("hex");
}
