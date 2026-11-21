import type { PlanTier } from "@/lib/types/plans";
import type { GatablePrincipal } from "@/lib/types/principal";

export type RestPrincipal = GatablePrincipal & {
  kind: "rest";
  apiKeyId: string;
  scopes: string[];
  plan: PlanTier | null;
  priceId: string | null;
};

export type RestApiKeyContext = {
  principal: RestPrincipal;
  requestId: string;
  ipHash: string | null;
  userAgent: string | null;
  endpoint: string;
  httpMethod: string;
  startedAt: number;
};
