import "server-only";

import type { WalletChain, SanctionsStatus } from "@/lib/types/database.types";
import type { NetworkConfig } from "@/lib/x402/networks";

/** Result of a successful register call. */
export interface RegisterSuccessPayload {
  /** Generated principalId: wallet_<32 hex chars>. */
  principalId: string;

  /** Same as principalId (wallets.id FKs principals.id). */
  walletId: string;

  /** Lowercased wallet address (EVM). */
  address: string;

  /** Network the wallet registered on. */
  chain: WalletChain;

  /** Sanctions status (always "clean" for fresh registrations). */
  sanctionsStatus: SanctionsStatus;

  /** Whether this was a new registration or an existing wallet returned. */
  isNew: boolean;

  /** x402_charges.id for this registration charge. Null if isNew=false. */
  chargeId: string | null;
}

/** Selected network for this registration, with all derived fields. */
export interface RegisterNetworkContext {
  network: NetworkConfig;
  /** X402_RECIPIENT_EVM env value. */
  recipientAddress: string;
  /** Parsed host from NEXT_PUBLIC_BASE_URL. */
  expectedDomain: string;
  /** Full URL of the register endpoint. */
  resourceUrl: string;
}
