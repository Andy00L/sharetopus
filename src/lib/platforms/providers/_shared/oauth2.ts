import "server-only";

import { parseJsonBody, providerFetch, readStringField } from "./providerFetch";

/**
 * Shared OAuth2 authorization-code plumbing.
 *
 * Sixteen of the remaining providers differ only in URLs, scopes, and how
 * they name the profile fields. Without this, each would carry its own copy
 * of the same authorize-URL builder and token-exchange call, which is how
 * the original seven platforms ended up with four parallel switch
 * statements. A provider supplies configuration; this supplies behavior.
 *
 * Called by: the oauth2 provider modules.
 * Tables touched: none.
 */

const OAUTH_TIMEOUT_MS = 20_000;

export type OAuth2Config = {
  /** Provider's authorize endpoint. */
  authorizeUrl: string;
  /** Provider's token endpoint. */
  tokenUrl: string;
  /** Env var holding the client id. */
  clientIdEnv: string;
  /** Env var holding the client secret. */
  clientSecretEnv: string;
  /** Scopes, already joined with the separator this provider expects. */
  scope: string;
  /**
   * Extra authorize-URL parameters. Use for the flags that decide whether
   * a refresh token is issued at all (Reddit's duration=permanent,
   * Google's access_type=offline).
   */
  extraAuthorizeParams?: Record<string, string>;
  /**
   * True when the token endpoint wants HTTP Basic with the client
   * credentials instead of them in the form body. Reddit and Twitch differ
   * here, and getting it wrong yields an opaque 401.
   */
  useBasicAuthForToken: boolean;
};

export type BuildAuthorizeUrlResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

/**
 * Builds the authorize URL, or reports which env var is missing. Returning
 * the failure rather than throwing means an unconfigured provider is a
 * clear message, not a 500 halfway through a redirect.
 */
export function buildOAuth2AuthorizeUrl(
  config: OAuth2Config,
  input: { state: string; redirectUri: string; codeChallenge: string | null },
): BuildAuthorizeUrlResult {
  const clientId = process.env[config.clientIdEnv];
  if (!clientId) {
    return {
      ok: false,
      message: `${config.clientIdEnv} is not configured.`,
    };
  }

  const authorizeUrl = new URL(config.authorizeUrl);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", input.redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", config.scope);
  authorizeUrl.searchParams.set("state", input.state);

  for (const [name, value] of Object.entries(
    config.extraAuthorizeParams ?? {},
  )) {
    authorizeUrl.searchParams.set(name, value);
  }

  if (input.codeChallenge) {
    authorizeUrl.searchParams.set("code_challenge", input.codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
  }

  return { ok: true, url: authorizeUrl.toString() };
}

export type OAuth2TokenResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      expiresIn: number | null;
    }
  | { ok: false; message: string };

/** Exchanges an authorization code for tokens. */
export async function exchangeOAuth2Code(
  config: OAuth2Config,
  input: { code: string; redirectUri: string; codeVerifier: string | null },
): Promise<OAuth2TokenResult> {
  return requestToken(config, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
  });
}

/** Exchanges a refresh token for a fresh access token. */
export async function refreshOAuth2Token(
  config: OAuth2Config,
  refreshToken: string,
): Promise<OAuth2TokenResult> {
  return requestToken(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

async function requestToken(
  config: OAuth2Config,
  formFields: Record<string, string>,
): Promise<OAuth2TokenResult> {
  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];

  if (!clientId || !clientSecret) {
    const missing = [
      !clientId && config.clientIdEnv,
      !clientSecret && config.clientSecretEnv,
    ].filter(Boolean);
    return {
      ok: false,
      message: `Missing env: ${missing.join(", ")}.`,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  const body = new URLSearchParams(formFields);

  if (config.useBasicAuthForToken) {
    headers.Authorization = `Basic ${Buffer.from(
      `${clientId}:${clientSecret}`,
      "utf-8",
    ).toString("base64")}`;
  } else {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  }

  const tokenResult = await providerFetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: body.toString(),
    timeoutMs: OAUTH_TIMEOUT_MS,
  });

  if (!tokenResult.ok) return { ok: false, message: tokenResult.message };
  if (tokenResult.status !== 200) {
    // The body carries the provider's error slug (invalid_grant,
    // redirect_uri_mismatch), which is the actionable part. The client
    // secret is never in the response, so echoing a slice is safe.
    return {
      ok: false,
      message: `Token exchange failed (${tokenResult.status}): ${tokenResult.bodyText.slice(0, 200)}`,
    };
  }

  const tokenBody = parseJsonBody(tokenResult.bodyText);
  const accessToken = readStringField(tokenBody, "access_token");
  if (!accessToken) {
    return { ok: false, message: "Token response carried no access_token." };
  }

  const rawExpiresIn =
    tokenBody && typeof tokenBody === "object"
      ? (tokenBody as Record<string, unknown>).expires_in
      : undefined;

  return {
    ok: true,
    accessToken,
    refreshToken: readStringField(tokenBody, "refresh_token"),
    expiresIn: typeof rawExpiresIn === "number" ? rawExpiresIn : null,
  };
}
