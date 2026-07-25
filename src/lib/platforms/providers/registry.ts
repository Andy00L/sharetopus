import "server-only";

import { PROVIDER_CATALOG, getProviderMetadata } from "./catalog";
import type { ProviderBehavior, ProviderDefinition, ProviderMetadata } from "./types";

import { blueskyBehavior } from "./bluesky";
import { devtoBehavior } from "./devto";
import { discordBehavior } from "./discord";
import { mastodonBehavior } from "./mastodon";
import { slackBehavior } from "./slack";
import { telegramBehavior } from "./telegram";
import { wordpressBehavior } from "./wordpress";

/**
 * Server-side provider registry: metadata from the catalog joined with the
 * behavior each provider module supplies.
 *
 * Server-only because every behavior here reads or transmits credentials.
 * The connect UI and the REST/MCP schemas import catalog.ts instead.
 *
 * Adding a provider: one catalog entry, one module, one line in
 * PROVIDER_BEHAVIORS below.
 */

const PROVIDER_BEHAVIORS: Readonly<Record<string, ProviderBehavior>> = {
  bluesky: blueskyBehavior,
  mastodon: mastodonBehavior,
  telegram: telegramBehavior,
  discord: discordBehavior,
  slack: slackBehavior,
  devto: devtoBehavior,
  wordpress: wordpressBehavior,
};

/**
 * Whether every env var this provider needs is present.
 *
 * This is the "it just works once the keys are set" switch. A provider
 * whose env is incomplete is hidden from the connect UI and refused by the
 * connect endpoints, so a user never gets half way through a redirect
 * before discovering a client secret was missing.
 *
 * Credentials providers declare no requiredEnv and are therefore always
 * available: the user brings their own key.
 */
export function isProviderConfigured(metadata: ProviderMetadata): boolean {
  return metadata.requiredEnv.every((envVarName) => {
    const value = process.env[envVarName];
    return typeof value === "string" && value.trim().length > 0;
  });
}

/**
 * Full definition for a provider id, or null when the id is unknown or the
 * provider has no behavior wired yet. Callers fail closed on null.
 */
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

/**
 * Same as getProvider, but also requires the provider's env to be set.
 * Use at every request entry point (connect, publish, tool trigger) so an
 * unconfigured provider is rejected with a clear reason.
 */
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

/**
 * Every provider that is both wired and configured, for the connect UI and
 * for the REST/MCP "what can I post to" surfaces. Metadata only: no
 * behavior functions cross this boundary.
 */
export function listAvailableProviders(): ProviderMetadata[] {
  return Object.values(PROVIDER_CATALOG)
    .filter((metadata) => PROVIDER_BEHAVIORS[metadata.id] !== undefined)
    .filter((metadata) => isProviderConfigured(metadata));
}
