import type { MediaType } from "@/db/schema";
import type {
  PlatformFailure,
  PlatformFailureReason,
} from "@/lib/api/_shared/platformFailure";

export type ProviderAuthKind =
  | "oauth2"
  /** Redirect dance plus RFC 7636 PKCE (provider mandates a code challenge). */
  | "oauth2_pkce"
  | "credentials";

export type ProviderCredentialField = {
  key: string;
  label: string;
  kind: "text" | "secret" | "url";
  required: boolean;
  placeholder: string;
  helpText: string;
  mapsTo?: "access_token" | "refresh_token";
};

export type ProviderPostingRules = {
  maxTextLength: number;
  supportedMediaTypes: readonly MediaType[];
  maxMediaPerPost: number;
  mediaRequired: boolean;
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
  config: Record<string, unknown>;
  accountIdentifier: string;
  title: string;
  body: string;
  postType: MediaType;
  mediaUrl: string | null;
  fileName: string;
  mediaMimeType: string;
  options: Record<string, unknown>;
  idempotencyKey: string | null;
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
      config: Record<string, unknown>;
    }
  | { ok: false; message: string };

export type TokenRefreshFailureReason = Extract<
  PlatformFailureReason,
  "auth_expired" | "transient"
>;

export type ProviderRefreshInput = {
  accessToken: string | null;
  refreshToken: string | null;
  config: Record<string, unknown>;
};

export type ProviderRefreshResult =
  | {
      ok: true;
      accessToken: string;
      rotatedRefreshToken: string | null;
      expiresIn: number | null;
    }
  | { ok: false; message: string; reason: TokenRefreshFailureReason };

export type ProviderMetadata = {
  id: string;
  label: string;
  category: "social" | "chat" | "blog" | "video" | "business";
  authKind: ProviderAuthKind;
  rules: ProviderPostingRules;
  requiredEnv: readonly string[];
  credentialFields?: readonly ProviderCredentialField[];
  tools: readonly ProviderTool[];
};

export type ProviderBehavior = {
  connect: (input: ProviderConnectInput) => Promise<ProviderConnectResult>;

  /** Publishes one post. Errors as values; never throws across this boundary. */
  publish: (input: ProviderPublishInput) => Promise<ProviderPublishResult>;

  refresh?: (input: ProviderRefreshInput) => Promise<ProviderRefreshResult>;
  runTool?: (input: ProviderToolInput) => Promise<ProviderToolResult>;
  buildAuthorizeUrl?: (input: {
    state: string;
    redirectUri: string;
    codeChallenge: string | null;
  }) => { ok: true; url: string } | { ok: false; message: string };
};

export type ProviderDefinition = ProviderMetadata & ProviderBehavior;

export type ProviderConnectInput =
  | {
      kind: "credentials";
      values: Record<string, string>;
    }
  | {
      kind: "oauth_code";
      code: string;
      redirectUri: string;
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
