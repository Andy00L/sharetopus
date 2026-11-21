import "server-only";
import type { PlanTier } from "@/lib/types/plans";

export type McpPrincipalKind = "apikey" | "oauth";

export type McpPrincipal =
  | {
      kind: "apikey";
      principalId: string;
      apiKeyId: string;
      scopes: string[];
      plan: PlanTier | null;
      priceId: string | null;
      oauthClientId?: undefined;
    }
  | {
      kind: "oauth";
      principalId: string;
      oauthClientId: string;
      scopes: string[];
      plan: PlanTier | null;
      priceId: string | null;
      apiKeyId?: undefined;
    };

export function assertExhaustiveKind(value: never): never {
  throw new Error(
    `[assertExhaustiveKind] Unhandled principal kind: ${JSON.stringify(value)}`
  );
}
