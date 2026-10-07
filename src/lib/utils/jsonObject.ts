import { z } from "zod";

import type { Json } from "@/db/schema";

/** A parsed JSON object whose fields are still unchecked. */
export type JsonObject = Record<string, unknown>;

/** True for a plain object (not null, not an array): what JSON.parse returns for `{...}`. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value when it is a JSON object, else null; reads nested JSON without a cast. */
export function toJsonObject(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

/**
 * The value as a jsonb column stores it: a JSON round trip (undefined keys drop, dates become
 * strings), then checked to be JSON. Null when it cannot be serialized (a cycle, a BigInt).
 */
export function toJsonValue(value: unknown): Json {
  try {
    const serializedValue: unknown = JSON.parse(JSON.stringify(value ?? null));
    const jsonValue = z.json().safeParse(serializedValue);
    return jsonValue.success ? jsonValue.data : null;
  } catch {
    return null;
  }
}
