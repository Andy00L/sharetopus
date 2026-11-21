import "server-only";

import type { PostingPlatform } from "@/lib/platforms/capabilities";
import type { NetworkConfig } from "@/lib/x402/networks";

export type Platform = PostingPlatform;

export type ConnectSuccessPayload = {
  connectionId: string;
  platform: Platform;
  oauthUrl: string | null;
  connectionToken: string | null;
  expiresAt: string;
  isReconnect: boolean;
};

export interface ConnectNetworkContext {
  network: NetworkConfig;
  recipientAddress: string;
  resourceUrl: string;
  platform: Platform;
}
