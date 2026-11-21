import type { Json, MediaType } from "@/db/schema";
import type {
  PlatformFailure,
  PlatformFailureReason,
} from "@/lib/api/_shared/platformFailure";
import type { RefreshTokenRotation } from "@/lib/api/refreshWithAccountLock";
import type { RegistryPublishOptions } from "@/lib/platforms/postTargetOptions";

import type { SignedStorageUrl } from "./_shared/signedStorageUrl";
import type { RegistryPlatformId } from "./catalog";

export type ProviderAuthKind =
  | "oauth2"
  /** Redirect dance plus RFC 7636 PKCE (provider mandates a code challenge). */
  | "oauth2_pkce"
  | "credentials";

type OAuthAuthKind = Exclude<ProviderAuthKind, "credentials">;

export type ProviderConfig = { [key: string]: Json | undefined };

export type ProviderCredentialField = {
  key: string;
  label: string;
  kind: "text" | "secret" | "url";
  required: boolean;
  placeholder: string;
  helpText: string;
};

export type ProviderPostingRules = {
  maxTextLength: number;
  supportedMediaTypes: readonly MediaType[];
  /**
   * True when publish EMBEDS the media URL in durable content instead of
   * re-hosting the bytes (markdown image, link post, chat message). The
   * worker then mints a long-lived URL and skips post-publish storage
   * cleanup, because deleting the file would kill the published embed.
   * Absent means false: the provider fetches at send time or uploads
   * bytes, so the short-lived URL and normal cleanup are safe.
   */
  hotlinksMedia?: true;
  titleRequired?: true;
};

export type ProviderTool = {
  methodName: string;
  description: string;
  parameters: readonly ProviderToolParameter[];
};

export type ProviderToolParameter = {
  name: string;
  kind: "string" | "number" | "boolean";
  required: boolean;
  description: string;
};

export type ProviderAccountIdentity = {
  accountIdentifier: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export type ProviderPublishInput = {
  accessToken: string;
  config: ProviderConfig;
  accountIdentifier: string;
  title: string;
  body: string;
  postType: MediaType;
  mediaUrl: SignedStorageUrl | null;
  fileName: string;
  mediaMimeType: string;
  options: RegistryPublishOptions;
  idempotencyKey: string;
};

export type ProviderPublishFailure = {
  ok: false;
  message: string;
  failure: PlatformFailure;
};

export type ProviderPublishResult =
  | { ok: true; postId: string; postUrl: string | null }
  | ProviderPublishFailure;

export type ProviderConnectResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      /** Seconds until expiry, or null when the token does not expire. */
      expiresIn: number | null;
      identity: ProviderAccountIdentity;
      config: ProviderConfig;
    }
  | { ok: false; message: string };

export type TokenRefreshFailureReason = Extract<
  PlatformFailureReason,
  "auth_expired" | "transient"
>;

export type ProviderRefreshInput = {
  accessToken: string | null;
  refreshToken: string | null;
  config: ProviderConfig;
};

export type ProviderRefreshResult =
  | {
      ok: true;
      accessToken: string;
      rotatedRefreshToken: string | null;
      expiresIn: number | null;
    }
  | { ok: false; message: string; reason: TokenRefreshFailureReason };

type ProviderMetadataBase = {
  id: RegistryPlatformId;
  label: string;
  category: "social" | "chat" | "blog" | "video" | "business";
  rules: ProviderPostingRules;
  requiredEnv: readonly string[];
  tools: readonly ProviderTool[];
};

export type ProviderMetadata =
  | (ProviderMetadataBase & {
      authKind: "credentials";
      credentialFields: readonly ProviderCredentialField[];
    })
  | (ProviderMetadataBase & { authKind: OAuthAuthKind });

export type CredentialsConnectInput = { values: Readonly<Record<string, string>> };

export type OAuthCodeConnectInput = { code: string; redirectUri: string };

export type PkceCodeConnectInput = OAuthCodeConnectInput & { codeVerifier: string };

export type AuthorizeUrlInput = {
  state: string;
  redirectUri: string;
  codeChallenge: string | null;
};

export type AuthorizeUrlResult = { ok: true; url: string } | { ok: false; message: string };

type ConnectOperation<ConnectInput> = (input: ConnectInput) => Promise<ProviderConnectResult>;

export type ProviderRefreshOperations =
  | {
      refresh: (input: ProviderRefreshInput) => Promise<ProviderRefreshResult>;
      refreshTokenRotation: RefreshTokenRotation;
    }
  | { refresh?: undefined; refreshTokenRotation?: undefined };

export type ProviderOperations = {
  /** Publishes one post. Errors as values; never throws across this boundary. */
  publish: (input: ProviderPublishInput) => Promise<ProviderPublishResult>;

  runTool?: (input: ProviderToolInput) => Promise<ProviderToolResult>;
} & ProviderRefreshOperations;

type AuthorizeUrlOperation = {
  buildAuthorizeUrl: (input: AuthorizeUrlInput) => AuthorizeUrlResult;
};

export type ProviderBehavior =
  | (ProviderOperations & {
      authKind: "credentials";
      connect: ConnectOperation<CredentialsConnectInput>;
    })
  | (ProviderOperations &
      AuthorizeUrlOperation & {
        authKind: "oauth2";
        connect: ConnectOperation<OAuthCodeConnectInput>;
      })
  | (ProviderOperations &
      AuthorizeUrlOperation & {
        authKind: "oauth2_pkce";
        connect: ConnectOperation<PkceCodeConnectInput>;
      });

export type ProviderDefinition = ProviderMetadataBase & ProviderBehavior;

export type ProviderToolInput = {
  methodName: string;
  accessToken: string;
  config: ProviderConfig;
  parameters: Record<string, unknown>;
};

export type ProviderToolResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string };
