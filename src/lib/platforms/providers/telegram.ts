import "server-only";

import type {
  ProviderBehavior,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
  ProviderToolInput,
  ProviderToolResult,
} from "./types";
import { parseJsonBody, providerFetch } from "./_shared/providerFetch";

/**
 * Telegram provider. Posts to a channel or group through a bot the user
 * creates with @BotFather, so nothing needs registering on our side and the
 * connection works the moment the token is pasted.
 *
 * The bot token IS the credential and never expires, which is why this
 * provider declares no refresh. It is stored in access_token and appears in
 * the request path, so it must never reach a log line.
 *
 * sourceRef: core.telegram.org/bots/api (getMe, getChat, sendMessage,
 * sendPhoto, sendVideo).
 */

const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
const TELEGRAM_TIMEOUT_MS = 20_000;

/** Telegram caption limit on media messages, shorter than sendMessage. */
const TELEGRAM_CAPTION_MAX_CHARS = 1024;

/**
 * Calls one Bot API method. The token sits in the path, so failures are
 * reported by method name only, never by URL.
 */
async function callBotApi(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; message: string }> {
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
    return { ok: false, message: `Telegram ${method} failed: ${callResult.message}` };
  }

  const parsed = parseJsonBody(callResult.bodyText);
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, message: `Telegram ${method} returned no JSON.` };
  }

  const envelope = parsed as Record<string, unknown>;
  if (envelope.ok !== true) {
    // description carries the actionable reason ("chat not found", "bot is
    // not a member of the channel chat"), so it is worth surfacing verbatim.
    const description =
      typeof envelope.description === "string"
        ? envelope.description
        : `HTTP ${callResult.status}`;
    return { ok: false, message: `Telegram ${method} failed: ${description}` };
  }

  return { ok: true, result: envelope.result };
}

async function connect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return { ok: false, message: "Telegram connects with a bot token." };
  }

  const botToken = (input.values.botToken ?? "").trim();
  const chatId = (input.values.chatId ?? "").trim();

  if (!botToken || !chatId) {
    return { ok: false, message: "Bot token and chat ID are both required." };
  }

  const identityResult = await callBotApi(botToken, "getMe", {});
  if (!identityResult.ok) {
    return { ok: false, message: identityResult.message };
  }

  const bot = identityResult.result as Record<string, unknown> | null;
  const botId = bot && typeof bot.id === "number" ? String(bot.id) : null;
  if (!botId) {
    return { ok: false, message: "Telegram getMe returned no bot id." };
  }

  // Confirm the bot can actually see the target chat now, rather than
  // letting the first scheduled post be the thing that discovers the bot
  // was never added as an administrator.
  const chatResult = await callBotApi(botToken, "getChat", { chat_id: chatId });
  if (!chatResult.ok) {
    return {
      ok: false,
      message: `${chatResult.message}. Add the bot to the channel as an administrator, then try again.`,
    };
  }

  const chat = chatResult.result as Record<string, unknown> | null;
  const chatTitle =
    chat && typeof chat.title === "string" ? chat.title : chatId;

  return {
    ok: true,
    accessToken: botToken,
    refreshToken: null,
    expiresIn: null,
    identity: {
      // The chat is the posting target, so it is the account identity;
      // one bot can serve several channels as separate connections.
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

  const messageText = buildMessageText(input);

  if (input.mediaType === "text" || !input.mediaUrl) {
    const sendResult = await callBotApi(input.accessToken, "sendMessage", {
      chat_id: chatId,
      text: messageText,
    });
    if (!sendResult.ok) return { ok: false, message: sendResult.message };
    return buildPublishResult(sendResult.result, chatId);
  }

  // Telegram fetches the media itself from the URL we pass, so no upload
  // step is needed. Captions are capped shorter than plain messages.
  const caption = messageText.slice(0, TELEGRAM_CAPTION_MAX_CHARS);
  const isVideo = input.mediaType === "video";
  const sendResult = await callBotApi(
    input.accessToken,
    isVideo ? "sendVideo" : "sendPhoto",
    {
      chat_id: chatId,
      [isVideo ? "video" : "photo"]: input.mediaUrl,
      caption,
    },
  );

  if (!sendResult.ok) return { ok: false, message: sendResult.message };
  return buildPublishResult(sendResult.result, chatId);
}

function buildPublishResult(
  sendResult: unknown,
  chatId: string,
): ProviderPublishResult {
  const message = sendResult as Record<string, unknown> | null;
  const messageId =
    message && typeof message.message_id === "number"
      ? String(message.message_id)
      : null;

  if (!messageId) {
    return { ok: false, message: "Telegram returned no message id." };
  }

  // Public channels have a t.me permalink; numeric chat IDs (private
  // groups) have none, so the URL is null rather than a broken guess.
  const postUrl = chatId.startsWith("@")
    ? `https://t.me/${chatId.slice(1)}/${messageId}`
    : null;

  return { ok: true, postId: messageId, postUrl };
}

/** Telegram has no title field, so a title becomes the first line. */
function buildMessageText(input: ProviderPublishInput): string {
  const trimmedTitle = input.title.trim();
  const trimmedBody = input.body.trim();
  if (!trimmedTitle) return trimmedBody;
  if (!trimmedBody) return trimmedTitle;
  return `${trimmedTitle}\n\n${trimmedBody}`;
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

  const chat = chatResult.result as Record<string, unknown> | null;
  return {
    ok: true,
    data: {
      id: chat && typeof chat.id === "number" ? chat.id : null,
      title: chat && typeof chat.title === "string" ? chat.title : null,
      type: chat && typeof chat.type === "string" ? chat.type : null,
    },
  };
}

export const telegramBehavior: ProviderBehavior = {
  connect,
  publish,
  runTool,
};
