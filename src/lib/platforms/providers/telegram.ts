import "server-only";

import type {
  CredentialsConnectInput,
  ProviderBehavior,
  ProviderConnectResult,
  ProviderPublishFailure,
  ProviderPublishInput,
  ProviderPublishResult,
  ProviderToolInput,
  ProviderToolResult,
} from "./types";
import { toJsonObject } from "@/lib/utils/jsonObject";

import {
  parseJsonObject,
  providerFetch,
  type ProviderFetchFailure,
} from "./_shared/providerFetch";
import { BYTES_PER_MB, readStoredMediaBytes } from "./_shared/fetchStoredMedia";
import { joinTitleAndBody } from "./_shared/postText";
import {
  classifyHttpAnswer,
  failProviderFetch,
  failUnreadableAnswer,
  refusePublish,
} from "./_shared/publishFailure";

/**
 * core.telegram.org/bots/features (BotFather): the token "is required to
 * authorize the bot and send requests to the Bot API", and a new one comes
 * only from BotFather's /token command. The Bot API has no refresh method,
 * so this provider declares none.
 *
 * sourceRef: core.telegram.org/bots/api (getMe, getChat, sendMessage,
 * sendPhoto, sendVideo).
 */

const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
const TELEGRAM_TIMEOUT_MS = 20_000;

/** Telegram caption limit on media messages, shorter than sendMessage. */
const TELEGRAM_CAPTION_MAX_CHARS = 1024;

// core.telegram.org/bots/api (Sending files) by HTTP URL: "5 MB max size for
// photos and 20 MB max for other types of content".
const TELEGRAM_URL_PHOTO_MAX_MB = 5;
const TELEGRAM_URL_VIDEO_MAX_MB = 20;

/**
 * Calls one Bot API method. The token sits in the path, so failures are
 * reported by method name only, never by URL.
 */
type BotApiFailure =
  | { ok: false; kind: "fetch"; message: string; fetchFailure: ProviderFetchFailure }
  | { ok: false; kind: "answer"; message: string; httpStatus: number; bodyText: string };

async function callBotApi(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | BotApiFailure> {
  const callResult = await providerFetch(
    `${TELEGRAM_API_ORIGIN}/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: TELEGRAM_TIMEOUT_MS,
    },
  );

  if (!callResult.ok) {
    return {
      ok: false,
      kind: "fetch",
      message: `Telegram ${method} failed: ${callResult.message}`,
      fetchFailure: callResult,
    };
  }

  const envelope = parseJsonObject(callResult.bodyText);
  if (!envelope) {
    return {
      ok: false,
      kind: "answer",
      message: `Telegram ${method} returned no JSON.`,
      httpStatus: callResult.status,
      bodyText: callResult.bodyText,
    };
  }

  if (envelope.ok !== true) {
    // description carries the actionable reason ("chat not found", "bot is
    // not a member of the channel chat"), so it is worth surfacing verbatim.
    const description =
      typeof envelope.description === "string"
        ? envelope.description
        : `HTTP ${callResult.status}`;
    return {
      ok: false,
      kind: "answer",
      message: `Telegram ${method} failed: ${description}`,
      httpStatus:
        typeof envelope.error_code === "number" ? envelope.error_code : callResult.status,
      bodyText: callResult.bodyText,
    };
  }

  return { ok: true, result: envelope.result };
}

async function connect(
  input: CredentialsConnectInput,
): Promise<ProviderConnectResult> {
  const botToken = (input.values.botToken ?? "").trim();
  const chatId = (input.values.chatId ?? "").trim();

  if (!botToken || !chatId) {
    return { ok: false, message: "Bot token and chat ID are both required." };
  }

  const identityResult = await callBotApi(botToken, "getMe", {});
  if (!identityResult.ok) {
    return { ok: false, message: identityResult.message };
  }

  const bot = toJsonObject(identityResult.result);
  const botId = bot && typeof bot.id === "number" ? String(bot.id) : null;
  if (!botId) {
    return { ok: false, message: "Telegram getMe returned no bot id." };
  }

  const chatResult = await callBotApi(botToken, "getChat", { chat_id: chatId });
  if (!chatResult.ok) {
    return {
      ok: false,
      message: `${chatResult.message}. Add the bot to the channel as an administrator, then try again.`,
    };
  }

  const chat = toJsonObject(chatResult.result);
  const chatTitle =
    chat && typeof chat.title === "string" ? chat.title : chatId;

  return {
    ok: true,
    accessToken: botToken,
    refreshToken: null,
    expiresIn: null,
    identity: {
      accountIdentifier: chatId,
      displayName: chatTitle,
      username:
        bot && typeof bot.username === "string" ? bot.username : null,
      avatarUrl: null,
    },
    config: { chatId, botId, chatTitle },
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const chatId =
    typeof input.config.chatId === "string"
      ? input.config.chatId
      : input.accountIdentifier;

  const messageText = joinTitleAndBody(input);

  if (input.postType === "text" || !input.mediaUrl) {
    const sendResult = await callBotApi(input.accessToken, "sendMessage", {
      chat_id: chatId,
      text: messageText,
    });
    if (!sendResult.ok) return failBotApiPublish(sendResult);
    return buildPublishResult(sendResult.result, chatId);
  }

  // Telegram fetches the media itself from the URL we pass, so no upload
  // step is needed. Captions are capped shorter than plain messages.
  const caption = messageText.slice(0, TELEGRAM_CAPTION_MAX_CHARS);
  const isVideo = input.postType === "video";
  const mediaSize = await readStoredMediaBytes(input.mediaUrl);
  if (!mediaSize.ok) return mediaSize;
  const maxMb = isVideo ? TELEGRAM_URL_VIDEO_MAX_MB : TELEGRAM_URL_PHOTO_MAX_MB;
  if (mediaSize.declaredBytes !== null && mediaSize.declaredBytes > maxMb * BYTES_PER_MB) {
    const mediaMb = (mediaSize.declaredBytes / BYTES_PER_MB).toFixed(1);
    return refusePublish(
      `Telegram accepts ${isVideo ? "videos" : "photos"} sent by link up to ${maxMb} MB; this file is ${mediaMb} MB.`,
    );
  }
  const sendResult = await callBotApi(
    input.accessToken,
    isVideo ? "sendVideo" : "sendPhoto",
    {
      chat_id: chatId,
      [isVideo ? "video" : "photo"]: input.mediaUrl,
      caption,
    },
  );

  if (!sendResult.ok) return failBotApiPublish(sendResult);
  return buildPublishResult(sendResult.result, chatId);
}

function failBotApiPublish(callFailure: BotApiFailure): ProviderPublishFailure {
  if (callFailure.kind === "fetch") {
    return {
      ...failProviderFetch({
        platform: "telegram",
        stage: "publish",
        fetchFailure: callFailure.fetchFailure,
      }),
      message: callFailure.message,
    };
  }
  return {
    ok: false,
    message: callFailure.message,
    failure: classifyHttpAnswer({
      platform: "telegram",
      stage: "publish",
      httpStatus: callFailure.httpStatus,
      bodyText: callFailure.bodyText,
    }),
  };
}

function buildPublishResult(
  sendResult: unknown,
  chatId: string,
): ProviderPublishResult {
  const message = toJsonObject(sendResult);
  const messageId =
    message && typeof message.message_id === "number"
      ? String(message.message_id)
      : null;

  if (!messageId) {
    return failUnreadableAnswer({
      message: "Telegram returned no message id.",
      stage: "publish",
    });
  }

  const postUrl = chatId.startsWith("@")
    ? `https://t.me/${chatId.slice(1)}/${messageId}`
    : null;

  return { ok: true, postId: messageId, postUrl };
}

async function runTool(input: ProviderToolInput): Promise<ProviderToolResult> {
  if (input.methodName !== "getChatInfo") {
    return {
      ok: false,
      message: `Unknown Telegram tool "${input.methodName}".`,
    };
  }

  const requestedChatId = input.parameters.chatId;
  const chatId =
    typeof requestedChatId === "string" && requestedChatId.trim().length > 0
      ? requestedChatId.trim()
      : typeof input.config.chatId === "string"
        ? input.config.chatId
        : null;

  if (!chatId) {
    return { ok: false, message: "chatId is required." };
  }

  const chatResult = await callBotApi(input.accessToken, "getChat", {
    chat_id: chatId,
  });
  if (!chatResult.ok) return { ok: false, message: chatResult.message };

  const chat = toJsonObject(chatResult.result);
  return {
    ok: true,
    data: {
      id: chat && typeof chat.id === "number" ? chat.id : null,
      title: chat && typeof chat.title === "string" ? chat.title : null,
      type: chat && typeof chat.type === "string" ? chat.type : null,
    },
  };
}

export const telegramBehavior = {
  authKind: "credentials",
  connect,
  publish,
  runTool,
} satisfies ProviderBehavior;
