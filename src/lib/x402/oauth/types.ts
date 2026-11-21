import "server-only";

import type { AdapterPlatform } from "@/lib/platforms/capabilities";

export interface ConnectionTokenPayload {
  connectionId: string;

  walletAddress: string;

  chargeId: string | null;

  iat: number;

  exp: number;

  platform: AdapterPlatform;
}
