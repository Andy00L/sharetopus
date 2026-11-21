import "server-only";

import type {
  OAuthCodeConnectInput,
  PkceCodeConnectInput,
  ProviderBehavior,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
} from "./types";
import { toJsonObject, type JsonObject } from "@/lib/utils/jsonObject";

import {
  parseJsonBody,
  parseJsonObject,
  providerFetch,
  readStringField,
} from "./_shared/providerFetch";
import {
  failHttpAnswer,
  failProviderFetch,
  failPublish,
  failUnreadableAnswer,
  refusePublish,
} from "./_shared/publishFailure";
import {
  buildOAuth2AuthorizeUrl,
  exchangeOAuth2Code,
  refreshOAuth2Credential,
  type OAuth2Config,
} from "./_shared/oauth2";
import { truncateToGraphemesAndBytes } from "./_shared/textLimits";
import { joinTitleAndBody } from "./_shared/postText";
import { REGISTRY_PROVIDER_CATALOG } from "./catalog";

const CHAT_TIMEOUT_MS = 20_000;

// docs.kick.com/apis/chat: "The content limit is 500 characters, counted as
// user-perceived characters (grapheme clusters)", and it must "encode to no
// more than 2048 bytes in UTF-8".
const KICK_CHAT_LIMITS = {
  maxGraphemes: REGISTRY_PROVIDER_CATALOG.kick.rules.maxTextLength,
  maxUtf8Bytes: 2048,
};

const TWITCH_MAX_CHARS = REGISTRY_PROVIDER_CATALOG.twitch.rules.maxTextLength;

const TWITCH_OAUTH: OAuth2Config = {
  authorizeUrl: "https://id.twitch.tv/oauth2/authorize",
  tokenUrl: "https://id.twitch.tv/oauth2/token",
  clientIdEnv: "TWITCH_CLIENT_ID",
  clientSecretEnv: "TWITCH_CLIENT_SECRET",
  scope: "user:read:email user:write:chat",
  useBasicAuthForToken: false,
};

async function twitchConnect(
  input: OAuthCodeConnectInput,
): Promise<ProviderConnectResult> {
  const tokens = await exchangeOAuth2Code(TWITCH_OAUTH, input);
  if (!tokens.ok) return { ok: false, message: tokens.message };

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

async function twitchPublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) {
    return refusePublish("TWITCH_CLIENT_ID is not configured.");
  }
  const broadcasterId =
    typeof input.config.broadcasterId === "string"
      ? input.config.broadcasterId
      : input.accountIdentifier;

  const message = joinTitleAndBody(input, { separator: " " })
    .concat(input.mediaUrl ? ` ${input.mediaUrl}` : "")
    .slice(0, TWITCH_MAX_CHARS);

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

  if (!result.ok) {
    return failProviderFetch({ platform: "twitch", stage: "publish", fetchFailure: result });
  }
  if (result.status !== 200) {
    return failHttpAnswer({
      platform: "twitch",
      stage: "publish",
      action: "Twitch chat send",
      httpStatus: result.status,
      bodyText: result.bodyText,
    });
  }

  const parsed = parseJsonObject(result.bodyText);
  const dataRows: unknown[] = Array.isArray(parsed?.data) ? parsed.data : [];
  const sendAnswer = toJsonObject(dataRows[0]);
  return readChatSendAnswer({
    platformLabel: "Twitch",
    sendAnswer,
    dropReason: readStringField(sendAnswer?.drop_reason, "message"),
  });
}

function readChatSendAnswer(input: {
  platformLabel: string;
  sendAnswer: JsonObject | null;
  dropReason: string | null;
}): ProviderPublishResult {
  const isSent = input.sendAnswer?.is_sent;
  if (isSent === false) {
    return failPublish({
      message: `${input.platformLabel} dropped the chat message (${input.dropReason ?? "no reason given"}).`,
      reason: "policy_rejected",
      mayHavePublished: false,
    });
  }
  const messageId = readStringField(input.sendAnswer, "message_id");
  if (isSent !== true || !messageId) {
    return failUnreadableAnswer({
      message: `${input.platformLabel} did not confirm the chat message.`,
      stage: "publish",
    });
  }
  return { ok: true, postId: messageId, postUrl: null };
}

export const twitchBehavior = {
  authKind: "oauth2",
  connect: twitchConnect,
  publish: twitchPublish,
  refresh: (input) => refreshOAuth2Credential(TWITCH_OAUTH, input),
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(TWITCH_OAUTH, input),
} satisfies ProviderBehavior;

const KICK_OAUTH: OAuth2Config = {
  authorizeUrl: "https://id.kick.com/oauth/authorize",
  tokenUrl: "https://id.kick.com/oauth/token",
  clientIdEnv: "KICK_CLIENT_ID",
  clientSecretEnv: "KICK_CLIENT_SECRET",
  scope: "user:read chat:write",
  useBasicAuthForToken: false,
};

async function kickConnect(
  input: PkceCodeConnectInput,
): Promise<ProviderConnectResult> {
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
  const parsed = parseJsonObject(userResult.bodyText);
  const dataRows: unknown[] = Array.isArray(parsed?.data) ? parsed.data : [];
  const user = toJsonObject(dataRows[0]);
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

async function kickPublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const broadcasterUserId = Number(input.config.broadcasterUserId);
  if (!Number.isInteger(broadcasterUserId) || broadcasterUserId <= 0) {
    return refusePublish("Stored Kick account has no broadcaster user id. Reconnect it.");
  }
  const message = truncateToGraphemesAndBytes(
    joinTitleAndBody(input, { separator: " " }).concat(input.mediaUrl ? ` ${input.mediaUrl}` : ""),
    KICK_CHAT_LIMITS,
  );

  const result = await providerFetch("https://api.kick.com/public/v1/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify({
      content: message,
      type: "user",
      broadcaster_user_id: broadcasterUserId,
    }),
    timeoutMs: CHAT_TIMEOUT_MS,
  });

  if (!result.ok) {
    return failProviderFetch({ platform: "kick", stage: "publish", fetchFailure: result });
  }
  if (result.status !== 200 && result.status !== 201) {
    return failHttpAnswer({
      platform: "kick",
      stage: "publish",
      action: "Kick chat send",
      httpStatus: result.status,
      bodyText: result.bodyText,
    });
  }

  return readChatSendAnswer({
    platformLabel: "Kick",
    sendAnswer: toJsonObject(parseJsonObject(result.bodyText)?.data),
    dropReason: null,
  });
}

export const kickBehavior = {
  authKind: "oauth2_pkce",
  connect: kickConnect,
  publish: kickPublish,
  refresh: (input) => refreshOAuth2Credential(KICK_OAUTH, input),
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(KICK_OAUTH, input),
} satisfies ProviderBehavior;
