import "server-only";

import type { WalletChain, SanctionsStatus } from "@/db/schema";

export interface WalletPrincipal {
  kind: "wallet";

  principalId: string;

  address: string;

  chain: WalletChain;

  sanctionsStatus: SanctionsStatus;
}
