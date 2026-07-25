import type { MediaType } from "@/lib/types/database.types";

/**
 * Provider contract for every publishing target.
 *
 * Why a registry instead of more switch arms: the seven original platforms
 * are wired through four separate per-platform switch statements
 * (buildOAuthUrl, refreshTokenForPlatform, dispatchTokenExchange,
 * callPlatformDirectPost) plus a hand-written adapter set each. Adding 26
 * platforms that way means 100+ new switch arms and 26 chances to
 * re-introduce the Instagram-style copy of the shared post flow. A provider
 * declares itself once here and every dispatcher looks it up.
 *
 * Client-safe: this module and registry.ts contain no secrets and no
 * "server-only" marker, because the connect UI and the REST/MCP schemas
 * need the metadata. Anything that touches credentials lives behind the
 * server-only functions a provider supplies.
 */

/** How a user proves ownership of an account on this provider. */
export type ProviderAuthKind =
  /** Redirect dance. Requires a registered app and per-provider env keys. */
  | "oauth2"
  /** Redirect dance plus RFC 7636 PKCE (provider mandates a code challenge). */
  | "oauth2_pkce"
  /**
   * User pastes credentials directly (API key, bot token, app password,
   * instance URL). No app registration, so these work the moment the user
   * has their own key. Declared by credentialFields.
   */
  | "credentials";

/**
 * One field in a credentials-based connect form. Drives the generic connect
 * UI, the REST schema, and the MCP tool schema, so a new provider needs no
 * bespoke form.
 */
export type ProviderCredentialField = {
  /** Stable key. Stored in social_accounts.extra unless mapsTo says otherwise. */
  key: string;
  label: string;
  /**
   * secret: never echoed back to the client after save.
   * url: validated as an absolute https URL (instance-hosted providers).
   */
  kind: "text" | "secret" | "url";
  required: boolean;
  placeholder: string;
  /** Shown under the field. Say exactly where the user finds this value. */
  helpText: string;
  /**
   * Column this value belongs in when it is the actual posting credential.
   * Everything without a mapsTo is provider config and lands in
   * social_accounts.extra.
   */
  mapsTo?: "access_token" | "refresh_token";
};

/** Text limits and media rules, used to validate before we call the API. */
export type ProviderPostingRules = {
  /** Max characters the provider accepts in the post body. */
  maxTextLength: number;
  /** Media types this provider can publish. Empty means text-only. */
  supportedMediaTypes: readonly MediaType[];
  /** Max attachments per post. 0 for text-only providers. */
  maxMediaPerPost: number;
  /** True when the provider requires media (no text-only posts). */
  mediaRequired: boolean;
};

/**
 * A provider-specific helper an agent can call before composing a post:
 * list Discord channels, fetch Reddit flairs, list LinkedIn pages, search
 * Instagram Reels audio. Exposed over MCP and REST through one generic
 * trigger endpoint so adding a tool needs no new route.
 */
export type ProviderTool = {
  /** Unique within the provider. Passed to the generic trigger endpoint. */
  methodName: string;
  description: string;
  /** JSON-schema-ish parameter declaration for the generic caller. */
  parameters: readonly ProviderToolParameter[];
};

export type ProviderToolParameter = {
  name: string;
  kind: "string" | "number" | "boolean";
  required: boolean;
  description: string;
};

/** Normalized account identity returned after a successful connect. */
export type ProviderAccountIdentity = {
  /** Provider-side stable id. Becomes social_accounts.account_identifier. */
  accountIdentifier: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
};

/** Everything a publish call needs, normalized across providers. */
export type ProviderPublishInput = {
  /** Posting credential resolved by the caller (refreshed when needed). */
  accessToken: string;
  /** Provider config saved at connect time (instance URL, channel id, ...). */
  config: Record<string, unknown>;
  /** Provider-side account id. */
  accountIdentifier: string;
  title: string;
  body: string;
  mediaType: MediaType;
  /**
   * Signed, publicly fetchable URL of the media, or null for text posts.
   * Providers that need bytes fetch this themselves through the shared
   * SSRF-guarded helper.
   */
  mediaUrl: string | null;
  fileName: string;
  /** MIME type derived from the stored file. */
  mediaMimeType: string;
  /** Per-post options the user set (subreddit, flair, visibility, ...). */
  options: Record<string, unknown>;
};

/**
 * Publish outcome. Mirrors PlatformPostOutcome so the worker's existing
 * retry classification applies unchanged.
 */
export type ProviderPublishResult =
  | { ok: true; postId: string; postUrl: string | null }
  | { ok: false; message: string };

/** Result of exchanging credentials or an OAuth code for a usable session. */
export type ProviderConnectResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      /** Seconds until expiry, or null when the token does not expire. */
      expiresIn: number | null;
      identity: ProviderAccountIdentity;
      /** Provider config to persist in social_accounts.extra. */
      config: Record<string, unknown>;
    }
  | { ok: false; message: string };

/**
 * Client-safe half of a provider declaration: pure data, no credentials,
 * no network code. The connect UI, the REST schemas, and the MCP tool
 * schemas read this, so it must never pull a provider's implementation
 * (and its secrets-reading code) into the browser bundle. Lives in
 * catalog.ts; the behavior half lives in registry.ts behind server-only.
 */
export type ProviderMetadata = {
  /** Matches the DB platform enum value. */
  id: string;
  label: string;
  /** Grouping for the connect UI. */
  category: "social" | "chat" | "blog" | "video" | "business";
  authKind: ProviderAuthKind;
  rules: ProviderPostingRules;

  /**
   * Env vars this provider needs before it can be offered at all. OAuth
   * providers list their client id and secret; credentials providers list
   * nothing, because the user brings their own key.
   *
   * isProviderConfigured() in registry.ts turns this into the "just works
   * once the keys are set" behavior: a provider with an unset env var is
   * hidden from the connect UI and rejected by the connect endpoints
   * instead of failing halfway through a redirect.
   */
  requiredEnv: readonly string[];

  /** Declared only when authKind is "credentials". */
  credentialFields?: readonly ProviderCredentialField[];

  /** Helper tools an agent can call. Empty when the provider has none. */
  tools: readonly ProviderTool[];
};

/**
 * Server-only half: everything that touches credentials or the network.
 * Supplied by each provider module and assembled in registry.ts.
 */
export type ProviderBehavior = {
  /**
   * Turns raw credentials (credentials providers) or an authorization code
   * (oauth providers) into a usable session plus account identity.
   */
  connect: (input: ProviderConnectInput) => Promise<ProviderConnectResult>;

  /** Publishes one post. Errors as values; never throws across this boundary. */
  publish: (input: ProviderPublishInput) => Promise<ProviderPublishResult>;

  /**
   * Refreshes an expiring token. Omitted when the provider issues
   * non-expiring credentials (most credentials providers).
   */
  refresh?: (refreshToken: string) => Promise<ProviderConnectResult>;

  /**
   * Executes one of `tools`. Omitted when the provider declares no tools.
   * Unknown methodName must return an error value, not throw.
   */
  runTool?: (input: ProviderToolInput) => Promise<ProviderToolResult>;

  /**
   * Builds the provider authorize URL. Declared only by oauth providers.
   * The PKCE challenge is supplied for oauth2_pkce providers, null
   * otherwise.
   */
  buildAuthorizeUrl?: (input: {
    state: string;
    redirectUri: string;
    codeChallenge: string | null;
  }) => { ok: true; url: string } | { ok: false; message: string };
};

/** Metadata plus behavior. What registry.ts stores and dispatchers consume. */
export type ProviderDefinition = ProviderMetadata & ProviderBehavior;

export type ProviderConnectInput =
  | {
      kind: "credentials";
      /** Raw values keyed by ProviderCredentialField.key. */
      values: Record<string, string>;
    }
  | {
      kind: "oauth_code";
      code: string;
      redirectUri: string;
      /** PKCE verifier for oauth2_pkce providers, null otherwise. */
      codeVerifier: string | null;
    };

export type ProviderToolInput = {
  methodName: string;
  accessToken: string;
  config: Record<string, unknown>;
  parameters: Record<string, unknown>;
};

export type ProviderToolResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string };
