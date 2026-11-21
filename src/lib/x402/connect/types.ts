import "server-only";

import type { AdapterPlatform } from "@/lib/platforms/capabilities";
import type { NetworkConfig } from "@/lib/x402/networks";

export type ConnectSuccessPayload = {
  connectionId: string;
  platform: AdapterPlatform;
  oauthUrl: string | null;
  connectionToken: string | null;
  expiresAt: string;
  isReconnect: boolean;
};

export interface ConnectNetworkContext {
  network: NetworkConfig;
  recipientAddress: string;
  resourceUrl: string;
  platform: AdapterPlatform;
}
