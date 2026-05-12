import "server-only";
import type { PlanTier } from "@/lib/types/plans";

export type McpPrincipalKind = "apikey" | "oauth";

export type McpPrincipal =
  | {
      kind: "apikey";
      principalId: string;
      apiKeyId: string;
      scopes: string[];
      plan: PlanTier;
      priceId: string | null;
      oauthClientId?: undefined;
    }
  | {
      kind: "oauth";
      principalId: string;
      oauthClientId: string;
      scopes: string[];
      plan: PlanTier;
      priceId: string | null;
      apiKeyId?: undefined;
    };

/**
 * Compile-time exhaustiveness check for McpPrincipal.kind switches.
 *
 * Throws at runtime if an unknown kind reaches it. The TypeScript
 * `never` type forces every kind to be handled at compile time.
 */
export function assertExhaustiveKind(value: never): never {
  throw new Error(
    `[assertExhaustiveKind] Unhandled principal kind: ${JSON.stringify(value)}`
  );
}
