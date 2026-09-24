import type { Json } from "@/db/schema";

/**
 * Narrows a provider config (Record<string, unknown>) to the Json shape
 * the social_accounts.extra column accepts.
 *
 * Provider configs only ever carry JSON-compatible primitives (instance
 * URLs, ids, numeric list ids), but their TypeScript type is unknown-valued
 * because providers build them dynamically. This walks one level and keeps
 * what is representable, dropping anything else, so the column type is
 * satisfied without a cast and a provider bug (a function or bigint in
 * config) degrades to an omitted key instead of a runtime serialization
 * throw.
 */
export function providerConfigToJson(
  config: Record<string, unknown>,
): { [key: string]: Json | undefined } {
  const jsonObject: { [key: string]: Json | undefined } = {};
  for (const [key, value] of Object.entries(config)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      jsonObject[key] = value;
    }
  }
  return jsonObject;
}
