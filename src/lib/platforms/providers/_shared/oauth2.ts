import "server-only";

import type {
  AuthorizeUrlInput,
  AuthorizeUrlResult,
  OAuthCodeConnectInput,
  ProviderRefreshInput,
  ProviderRefreshResult,
  TokenRefreshFailureReason,
} from "../types";
import { parseJsonObject, providerFetch, readStringField } from "./providerFetch";

const OAUTH_TIMEOUT_MS = 20_000;

const TOKEN_ERROR_DESCRIPTION_MAX_CHARS = 200;

export type OAuth2Config = {
  authorizeUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Scopes, already joined with the separator this provider expects. */
  scope: string;
  extraAuthorizeParams?: Record<string, string>;
  useBasicAuthForToken: boolean;
};

export function buildOAuth2AuthorizeUrl(
  config: OAuth2Config,
  input: AuthorizeUrlInput,
): AuthorizeUrlResult {
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
  | { ok: false; message: string; reason: TokenRefreshFailureReason };

export async function exchangeOAuth2Code(
  config: OAuth2Config,
  input: OAuthCodeConnectInput & { codeVerifier?: string },
): Promise<OAuth2TokenResult> {
  return requestToken(config, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
  });
}

export async function refreshOAuth2Credential(
  config: OAuth2Config,
  input: ProviderRefreshInput,
): Promise<ProviderRefreshResult> {
  if (!input.refreshToken) {
    return { ok: false, message: "No refresh token is stored.", reason: "auth_expired" };
  }
  const tokens = await requestToken(config, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  if (!tokens.ok) return tokens;
  return {
    ok: true,
    accessToken: tokens.accessToken,
    rotatedRefreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  };
}

// RFC 6749 section 5.2: a refused grant answers 400 (401 for invalid_client).
export function classifyTokenHttpStatus(httpStatus: number): TokenRefreshFailureReason {
  const isRefusedGrant = httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429;
  return isRefusedGrant ? "auth_expired" : "transient";
}

// RFC 6749 section 5.2: a token error is a JSON object with a required
// "error" code and optional "error_description" and "error_uri". Only the
// code and the description are echoed; nothing else of the body is.
function describeTokenError(httpStatus: number, bodyText: string): string {
  const tokenError = parseJsonObject(bodyText);
  const errorDetails = [
    readStringField(tokenError, "error"),
    readStringField(tokenError, "error_description")?.slice(0, TOKEN_ERROR_DESCRIPTION_MAX_CHARS),
  ].filter((errorDetail) => typeof errorDetail === "string" && errorDetail.length > 0);
  return errorDetails.length > 0
    ? `Token exchange failed (${httpStatus}): ${errorDetails.join(": ")}`
    : `Token exchange failed (${httpStatus}).`;
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
      reason: "transient",
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

  if (!tokenResult.ok) {
    return {
      ok: false,
      message: tokenResult.message,
      reason: "transient",
    };
  }
  if (tokenResult.status !== 200) {
    return {
      ok: false,
      message: describeTokenError(tokenResult.status, tokenResult.bodyText),
      reason: classifyTokenHttpStatus(tokenResult.status),
    };
  }

  const tokenBody = parseJsonObject(tokenResult.bodyText);
  const accessToken = readStringField(tokenBody, "access_token");
  if (!accessToken) {
    return {
      ok: false,
      message: "Token response carried no access_token.",
      reason: "transient",
    };
  }

  const rawExpiresIn = tokenBody?.expires_in;

  return {
    ok: true,
    accessToken,
    refreshToken: readStringField(tokenBody, "refresh_token"),
    expiresIn: typeof rawExpiresIn === "number" ? rawExpiresIn : null,
  };
}
