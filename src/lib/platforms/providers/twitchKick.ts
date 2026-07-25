import "server-only";

import type {
  ProviderBehavior,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
} from "./types";
import {
  parseJsonBody,
  providerFetch,
  readStringField,
} from "./_shared/providerFetch";
import {
  buildOAuth2AuthorizeUrl,
  exchangeOAuth2Code,
  refreshOAuth2Token,
  type OAuth2Config,
} from "./_shared/oauth2";

/**
 * Twitch and Kick providers, chat mode: "posting" publishes a message to
 * the streamer's own chat, which is what Postiz does for these platforms
 * too. Both are OAuth2 with refresh tokens; Kick mandates PKCE.
 *
 * sourceRef: dev.twitch.tv/docs/api (oauth2/validate, helix/chat/messages);
 * docs.kick.com (id.kick.com oauth, public/v1/users, public/v1/chat).
 */

const CHAT_TIMEOUT_MS = 20_000;

// ── Twitch ────────────────────────────────────────────────────────────────

const TWITCH_OAUTH: OAuth2Config = {
  authorizeUrl: "https://id.twitch.tv/oauth2/authorize",
  tokenUrl: "https://id.twitch.tv/oauth2/token",
  clientIdEnv: "TWITCH_CLIENT_ID",
  clientSecretEnv: "TWITCH_CLIENT_SECRET",
  scope: "user:read:email user:write:chat",
  useBasicAuthForToken: false,
};

async function twitchConnect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "oauth_code") {
    return { ok: false, message: "Twitch connects through OAuth." };
  }
  const tokens = await exchangeOAuth2Code(TWITCH_OAUTH, input);
  if (!tokens.ok) return { ok: false, message: tokens.message };

  // validate returns the user id and login for the token's owner.
  const validation = await providerFetch(
    "https://id.twitch.tv/oauth2/validate",
    {
      method: "GET",
      headers: { Authorization: `OAuth ${tokens.accessToken}` },
      timeoutMs: CHAT_TIMEOUT_MS,
    },
  );
  if (!validation.ok || validation.status !== 200) {
    return { ok: false, message: "Twitch token validation failed." };
  }
  const validated = parseJsonBody(validation.bodyText);
  const userId = readStringField(validated, "user_id");
  const login = readStringField(validated, "login");
  if (!userId) return { ok: false, message: "Twitch returned no user id." };

  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    identity: {
      accountIdentifier: userId,
      displayName: login,
      username: login,
      avatarUrl: null,
    },
    config: { broadcasterId: userId },
  };
}

async function twitchRefresh(
  refreshToken: string,
): Promise<ProviderConnectResult> {
  const tokens = await refreshOAuth2Token(TWITCH_OAUTH, refreshToken);
  if (!tokens.ok) return { ok: false, message: tokens.message };
  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? refreshToken,
    expiresIn: tokens.expiresIn,
    identity: {
      accountIdentifier: "unchanged",
      displayName: null,
      username: null,
      avatarUrl: null,
    },
    config: {},
  };
}

async function twitchPublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) {
    return { ok: false, message: "TWITCH_CLIENT_ID is not configured." };
  }
  const broadcasterId =
    typeof input.config.broadcasterId === "string"
      ? input.config.broadcasterId
      : input.accountIdentifier;

  const message = [input.title.trim(), input.body.trim()]
    .filter((part) => part.length > 0)
    .join(" ")
    // Twitch chat caps at 500 chars; media has no chat form, so the URL
    // rides along in the text.
    .concat(input.mediaUrl ? ` ${input.mediaUrl}` : "")
    .slice(0, 500);

  const result = await providerFetch(
    "https://api.twitch.tv/helix/chat/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        "Client-Id": clientId,
      },
      body: JSON.stringify({
        broadcaster_id: broadcasterId,
        sender_id: broadcasterId,
        message,
      }),
      timeoutMs: CHAT_TIMEOUT_MS,
    },
  );

  if (!result.ok) return { ok: false, message: result.message };
  if (result.status === 429) {
    return { ok: false, message: "Twitch rate limit reached (429)." };
  }
  if (result.status !== 200) {
    return {
      ok: false,
      message: `Twitch chat send failed (${result.status}): ${result.bodyText.slice(0, 200)}`,
    };
  }

  const parsed = parseJsonBody(result.bodyText) as Record<string, unknown> | null;
  const dataRows = Array.isArray(parsed?.data) ? parsed.data : [];
  const first =
    dataRows[0] && typeof dataRows[0] === "object"
      ? (dataRows[0] as Record<string, unknown>)
      : null;
  const messageId =
    first && typeof first.message_id === "string" ? first.message_id : null;
  if (!messageId) return { ok: false, message: "Twitch returned no message id." };

  return { ok: true, postId: messageId, postUrl: null };
}

export const twitchBehavior: ProviderBehavior = {
  connect: twitchConnect,
  publish: twitchPublish,
  refresh: twitchRefresh,
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(TWITCH_OAUTH, input),
};

// ── Kick ──────────────────────────────────────────────────────────────────

const KICK_OAUTH: OAuth2Config = {
  authorizeUrl: "https://id.kick.com/oauth/authorize",
  tokenUrl: "https://id.kick.com/oauth/token",
  clientIdEnv: "KICK_CLIENT_ID",
  clientSecretEnv: "KICK_CLIENT_SECRET",
  scope: "user:read chat:write",
  useBasicAuthForToken: false,
};

async function kickConnect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "oauth_code") {
    return { ok: false, message: "Kick connects through OAuth." };
  }
  // Kick mandates PKCE; the registry supplies the verifier because the
  // catalog declares authKind oauth2_pkce.
  if (!input.codeVerifier) {
    return { ok: false, message: "Kick requires PKCE; missing code verifier." };
  }
  const tokens = await exchangeOAuth2Code(KICK_OAUTH, input);
  if (!tokens.ok) return { ok: false, message: tokens.message };

  const userResult = await providerFetch("https://api.kick.com/public/v1/users", {
    method: "GET",
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
    timeoutMs: CHAT_TIMEOUT_MS,
  });
  if (!userResult.ok || userResult.status !== 200) {
    return { ok: false, message: "Kick user lookup failed." };
  }
  const parsed = parseJsonBody(userResult.bodyText) as Record<string, unknown> | null;
  const dataRows = Array.isArray(parsed?.data) ? parsed.data : [];
  const user =
    dataRows[0] && typeof dataRows[0] === "object"
      ? (dataRows[0] as Record<string, unknown>)
      : null;
  const userId =
    user && typeof user.user_id === "number" ? String(user.user_id) : null;
  if (!user || !userId) {
    return { ok: false, message: "Kick returned no user id." };
  }

  const kickUserName = typeof user.name === "string" ? user.name : null;
  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    identity: {
      accountIdentifier: userId,
      displayName: kickUserName,
      username: kickUserName,
      avatarUrl:
        typeof user.profile_picture === "string" ? user.profile_picture : null,
    },
    config: { broadcasterUserId: userId },
  };
}

async function kickRefresh(
  refreshToken: string,
): Promise<ProviderConnectResult> {
  const tokens = await refreshOAuth2Token(KICK_OAUTH, refreshToken);
  if (!tokens.ok) return { ok: false, message: tokens.message };
  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? refreshToken,
    expiresIn: tokens.expiresIn,
    identity: {
      accountIdentifier: "unchanged",
      displayName: null,
      username: null,
      avatarUrl: null,
    },
    config: {},
  };
}

async function kickPublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const message = [input.title.trim(), input.body.trim()]
    .filter((part) => part.length > 0)
    .join(" ")
    .concat(input.mediaUrl ? ` ${input.mediaUrl}` : "")
    .slice(0, 500);

  const result = await providerFetch("https://api.kick.com/public/v1/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify({ content: message, type: "user" }),
    timeoutMs: CHAT_TIMEOUT_MS,
  });

  if (!result.ok) return { ok: false, message: result.message };
  if (result.status === 429) {
    return { ok: false, message: "Kick rate limit reached (429)." };
  }
  if (result.status !== 200 && result.status !== 201) {
    return {
      ok: false,
      message: `Kick chat send failed (${result.status}): ${result.bodyText.slice(0, 200)}`,
    };
  }

  const parsed = parseJsonBody(result.bodyText) as Record<string, unknown> | null;
  const data =
    parsed && typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : null;
  const messageId =
    data && typeof data.message_id === "string" ? data.message_id : null;

  return {
    ok: true,
    // Kick's response id is best-effort; the send already succeeded.
    postId: messageId ?? "sent",
    postUrl: null,
  };
}

export const kickBehavior: ProviderBehavior = {
  connect: kickConnect,
  publish: kickPublish,
  refresh: kickRefresh,
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(KICK_OAUTH, input),
};
