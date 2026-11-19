import type { Json } from "@/db/schema";

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
