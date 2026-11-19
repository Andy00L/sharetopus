import "server-only";

import { FULL_PROVIDER_CATALOG, getProviderMetadata } from "./catalog";
import type { ProviderBehavior, ProviderDefinition, ProviderMetadata } from "./types";

import { blueskyBehavior } from "./bluesky";
import { devtoBehavior } from "./devto";
import { discordBehavior } from "./discord";
import { mastodonBehavior } from "./mastodon";
import { slackBehavior } from "./slack";
import { telegramBehavior } from "./telegram";
import { wordpressBehavior } from "./wordpress";
import { redditBehavior } from "./reddit";
import { threadsBehavior } from "./threads";
import { tumblrBehavior } from "./tumblr";
import { twitchBehavior, kickBehavior } from "./twitchKick";
import {
  hashnodeBehavior,
  lemmyBehavior,
  mediumBehavior,
} from "./blogCredentials";
import { farcasterBehavior, listmonkBehavior } from "./miscCredentials";
import { nostrBehavior } from "./nostr";
import {
  dribbbleBehavior,
  gmbBehavior,
  linkedinPageBehavior,
} from "./oauthVariants";

const PROVIDER_BEHAVIORS: Readonly<Record<string, ProviderBehavior>> = {
  bluesky: blueskyBehavior,
  mastodon: mastodonBehavior,
  telegram: telegramBehavior,
  discord: discordBehavior,
  slack: slackBehavior,
  devto: devtoBehavior,
  wordpress: wordpressBehavior,
  reddit: redditBehavior,
  threads: threadsBehavior,
  tumblr: tumblrBehavior,
  twitch: twitchBehavior,
  kick: kickBehavior,
  hashnode: hashnodeBehavior,
  medium: mediumBehavior,
  lemmy: lemmyBehavior,
  farcaster: farcasterBehavior,
  listmonk: listmonkBehavior,
  nostr: nostrBehavior,
  linkedin_page: linkedinPageBehavior,
  dribbble: dribbbleBehavior,
  gmb: gmbBehavior,
};

export function isProviderConfigured(metadata: ProviderMetadata): boolean {
  return metadata.requiredEnv.every((envVarName) => {
    const value = process.env[envVarName];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function getProvider(providerId: string): ProviderDefinition | null {
  const metadata = getProviderMetadata(providerId);
  if (!metadata) return null;

  const behavior = PROVIDER_BEHAVIORS[providerId];
  if (!behavior) {
    console.error(
      `[getProvider] Provider "${providerId}" is in the catalog but has no behavior registered.`,
    );
    return null;
  }

  return { ...metadata, ...behavior };
}

export type ResolveProviderResult =
  | { ok: true; provider: ProviderDefinition }
  | { ok: false; reason: "unknown_provider" | "not_configured"; message: string };

export function resolveConfiguredProvider(
  providerId: string,
): ResolveProviderResult {
  const provider = getProvider(providerId);
  if (!provider) {
    return {
      ok: false,
      reason: "unknown_provider",
      message: `Unknown provider "${providerId}".`,
    };
  }

  if (!isProviderConfigured(provider)) {
    const missing = provider.requiredEnv.filter(
      (envVarName) => !process.env[envVarName]?.trim(),
    );
    console.error(
      `[resolveConfiguredProvider] "${providerId}" is missing env: ${missing.join(", ")}`,
    );
    return {
      ok: false,
      reason: "not_configured",
      message: `${provider.label} is not configured on this deployment yet.`,
    };
  }

  return { ok: true, provider };
}

export function listAvailableProviders(): ProviderMetadata[] {
  return Object.values(FULL_PROVIDER_CATALOG)
    .filter((metadata) => PROVIDER_BEHAVIORS[metadata.id] !== undefined)
    .filter((metadata) => isProviderConfigured(metadata));
}
