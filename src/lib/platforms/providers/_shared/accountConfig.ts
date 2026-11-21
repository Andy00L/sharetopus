import type { Json } from "@/db/schema";

import type { ProviderConfig } from "../types";

export function readAccountConfig(storedExtra: Json): ProviderConfig {
  const isJsonObject =
    typeof storedExtra === "object" && storedExtra !== null && !Array.isArray(storedExtra);
  return isJsonObject ? storedExtra : {};
}
