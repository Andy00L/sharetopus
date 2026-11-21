import "server-only";

import type { Platform } from "@/lib/x402/connect/types";

export interface ConnectionTokenPayload {
  connectionId: string;

  walletAddress: string;

  chargeId: string | null;

  iat: number;

  exp: number;

  platform: Platform;
}
