import { nanoid } from "nanoid";

/** A 32-character URL-safe batch_id (191 bits); every post path calls it when the caller supplied none. */
export function generateBatchId(): string {
  return nanoid(32);
}
