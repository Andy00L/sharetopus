import "server-only";

import {
  getProviderMetadata,
  listProviderMetadata,
  REGISTRY_PLATFORM_IDS,
  type RegistryCatalogEntry,
  type RegistryPlatformId,
} from "./catalog";
import { findCredentialValueIssue } from "./credentialFields";
import type {
  ProviderBehavior,
  ProviderConnectResult,
  ProviderDefinition,
  ProviderMetadata,
  ProviderOperations,
  ProviderRefreshOperations,
} from "./types";

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

type ProviderBehaviorCatalog = {
  readonly [PlatformId in RegistryPlatformId]: Extract<
    ProviderBehavior,
    { authKind: RegistryCatalogEntry<PlatformId>["authKind"] }
  >;
};

const PROVIDER_BEHAVIORS: ProviderBehaviorCatalog = {
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

export function isProviderConfigured(metadata: Pick<ProviderMetadata, "requiredEnv">): boolean {
  return metadata.requiredEnv.every((envVarName) => {
    const value = process.env[envVarName];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function getProvider(providerId: string): ProviderDefinition | null {
  const metadata = getProviderMetadata(providerId);
  if (!metadata) return null;
  return {
    ...metadata,
    ...guardProviderBehavior(metadata, PROVIDER_BEHAVIORS[metadata.id]),
  };
}

async function settleThrown<Settled>(input: {
  operationLabel: string;
  runOperation: () => Promise<Settled>;
  buildFailure: (message: string) => Settled;
}): Promise<Settled> {
  try {
    return await input.runOperation();
  } catch (thrownError) {
    const message = thrownError instanceof Error ? thrownError.message : String(thrownError);
    console.error(`[settleThrown] ${input.operationLabel} threw: ${message}`);
    return input.buildFailure(message);
  }
}

function guardProviderBehavior(
  metadata: ProviderMetadata,
  behavior: ProviderBehavior,
): ProviderBehavior {
  const providerLabel = metadata.label;
  const guardedOperations = guardProviderOperations(providerLabel, behavior);
  const guardConnect = (runConnect: () => Promise<ProviderConnectResult>) =>
    settleThrown<ProviderConnectResult>({
      operationLabel: `${providerLabel} connect`,
      runOperation: runConnect,
      buildFailure: () => ({
        ok: false,
        message: `${providerLabel} could not be connected because of an unexpected error.`,
      }),
    });

  switch (behavior.authKind) {
    case "credentials": {
      const credentialFields =
        metadata.authKind === "credentials" ? metadata.credentialFields : [];
      const connect: typeof behavior.connect = async (input) => {
        const credentialIssue = findCredentialValueIssue({
          providerLabel,
          fields: credentialFields,
          values: input.values,
        });
        if (credentialIssue) return { ok: false, message: credentialIssue };
        return guardConnect(() => behavior.connect(input));
      };
      return { ...behavior, ...guardedOperations, connect };
    }
    case "oauth2": {
      const connect: typeof behavior.connect = (input) =>
        guardConnect(() => behavior.connect(input));
      return { ...behavior, ...guardedOperations, connect };
    }
    case "oauth2_pkce": {
      const connect: typeof behavior.connect = (input) =>
        guardConnect(() => behavior.connect(input));
      return { ...behavior, ...guardedOperations, connect };
    }
  }
}

function guardProviderOperations(
  providerLabel: string,
  operations: ProviderOperations,
): ProviderOperations {
  const { runTool } = operations;
  return {
    publish: (input) =>
      settleThrown({
        operationLabel: `${providerLabel} publish`,
        runOperation: () => operations.publish(input),
        buildFailure: (message) => ({
          ok: false,
          message: `${providerLabel} publish failed unexpectedly: ${message}`,
          failure: { reason: "unknown", mayHavePublished: true },
        }),
      }),
    ...guardRefreshOperations(providerLabel, operations),
    ...(runTool && {
      runTool: (input) =>
        settleThrown({
          operationLabel: `${providerLabel} ${input.methodName}`,
          runOperation: () => runTool(input),
          buildFailure: () => ({
            ok: false,
            message: "The provider tool failed unexpectedly.",
          }),
        }),
    }),
  };
}

function guardRefreshOperations(
  providerLabel: string,
  operations: ProviderRefreshOperations,
): ProviderRefreshOperations {
  if (!operations.refresh) return {};
  const { refresh } = operations;
  return {
    refreshTokenRotation: operations.refreshTokenRotation,
    refresh: (input) =>
      settleThrown({
        operationLabel: `${providerLabel} refresh`,
        runOperation: () => refresh(input),
        buildFailure: (message) => ({
          ok: false,
          message: `${providerLabel} token refresh failed unexpectedly: ${message}`,
          reason: "transient",
        }),
      }),
  };
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

export function listRefreshablePlatformIds(): RegistryPlatformId[] {
  return REGISTRY_PLATFORM_IDS.filter(
    (platformId) => PROVIDER_BEHAVIORS[platformId].refresh !== undefined,
  );
}

export function listAvailableProviders(): ProviderMetadata[] {
  return listProviderMetadata().filter((metadata) => isProviderConfigured(metadata));
}
