import "server-only";

import type {
  CredentialsConnectInput,
  ProviderBehavior,
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
  failHttpAnswer,
  failProviderFetch,
  failUnreadableAnswer,
  refusePublish,
} from "./_shared/publishFailure";
import { joinTitleAndBody } from "./_shared/postText";
import { REGISTRY_PROVIDER_CATALOG } from "./catalog";

/**
 * The webhook URL is both the credential and the target, so it is stored in
 * access_token and never logged.
 *
 * sourceRef: discord.com/developers/docs/resources/webhook (Get Webhook
 * with Token, Execute Webhook).
 */

const DISCORD_TIMEOUT_MS = 20_000;

const DISCORD_MAX_CHARS = REGISTRY_PROVIDER_CATALOG.discord.rules.maxTextLength;

const ALLOWED_DISCORD_HOSTS: readonly string[] = [
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discord.com",
];

type WebhookUrlValidation =
  | { ok: true; webhookUrl: string }
  | { ok: false; message: string };

function validateWebhookUrl(rawWebhookUrl: string): WebhookUrlValidation {
  const trimmed = rawWebhookUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: "Webhook URL is not a valid URL." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, message: "Webhook URL must use https." };
  }
  if (!ALLOWED_DISCORD_HOSTS.includes(parsed.hostname)) {
    return {
      ok: false,
      message: `Webhook URL must be hosted on Discord (got "${parsed.hostname}").`,
    };
  }
  if (!parsed.pathname.startsWith("/api/webhooks/")) {
    return {
      ok: false,
      message: "That does not look like a Discord webhook URL.",
    };
  }

  return { ok: true, webhookUrl: trimmed };
}

async function connect(
  input: CredentialsConnectInput,
): Promise<ProviderConnectResult> {
  const validation = validateWebhookUrl(input.values.webhookUrl ?? "");
  if (!validation.ok) return { ok: false, message: validation.message };

  // A GET on the webhook URL returns its metadata and proves the token in
  // the URL is live, so a revoked webhook is caught at connect time rather
  // than on the first scheduled post.
  const lookupResult = await providerFetch(validation.webhookUrl, {
    method: "GET",
    timeoutMs: DISCORD_TIMEOUT_MS,
  });

  if (!lookupResult.ok) return { ok: false, message: lookupResult.message };
  if (lookupResult.status === 401 || lookupResult.status === 404) {
    return {
      ok: false,
      message: "Discord does not recognize that webhook. It may have been deleted.",
    };
  }
  if (lookupResult.status !== 200) {
    return {
      ok: false,
      message: `Discord returned HTTP ${lookupResult.status} for that webhook.`,
    };
  }

  const webhook = parseJsonBody(lookupResult.bodyText);
  const webhookId = readStringField(webhook, "id");
  if (!webhookId) {
    return { ok: false, message: "Discord returned no webhook id." };
  }

  const channelId = readStringField(webhook, "channel_id");
  const webhookName = readStringField(webhook, "name");

  return {
    ok: true,
    accessToken: validation.webhookUrl,
    refreshToken: null,
    expiresIn: null,
    identity: {
      accountIdentifier: webhookId,
      displayName: webhookName,
      username: webhookName,
      avatarUrl: null,
    },
    config: {
      channelId,
      guildId: readStringField(webhook, "guild_id"),
    },
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const validation = validateWebhookUrl(input.accessToken);
  if (!validation.ok) return refusePublish(validation.message);

  const content = joinTitleAndBody(input, { formatTitle: (title) => `**${title}**` }).slice(
    0,
    DISCORD_MAX_CHARS,
  );

  const payload: Record<string, unknown> = { content };

  // Discord renders an image from an embed URL, so media needs no upload:
  // it fetches our signed URL itself. Video is not embeddable, so the URL
  // goes in the message body where Discord unfurls it.
  if (input.postType === "image" && input.mediaUrl) {
    payload.embeds = [{ image: { url: input.mediaUrl } }];
  } else if (input.postType === "video" && input.mediaUrl) {
    payload.content = `${content}\n${input.mediaUrl}`.slice(0, DISCORD_MAX_CHARS);
  }

  // wait=true makes Discord return the created message instead of 204, so
  // we get a real message id to store.
  const executeUrl = `${validation.webhookUrl}?wait=true`;
  const sendResult = await providerFetch(executeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: DISCORD_TIMEOUT_MS,
  });

  if (!sendResult.ok) {
    return failProviderFetch({
      platform: "discord",
      stage: "publish",
      fetchFailure: sendResult,
    });
  }
  if (sendResult.status !== 200) {
    return failHttpAnswer({
      platform: "discord",
      stage: "publish",
      action: "Discord webhook post",
      httpStatus: sendResult.status,
      bodyText: sendResult.bodyText,
    });
  }

  const message = parseJsonBody(sendResult.bodyText);
  const messageId = readStringField(message, "id");
  if (!messageId) {
    return failUnreadableAnswer({
      message: "Discord returned no message id.",
      stage: "publish",
    });
  }

  const channelId = readStringField(message, "channel_id");
  const guildId =
    typeof input.config.guildId === "string" ? input.config.guildId : null;

  return {
    ok: true,
    postId: messageId,
    postUrl:
      guildId && channelId
        ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
        : null,
  };
}

export const discordBehavior = {
  authKind: "credentials",
  connect,
  publish,
} satisfies ProviderBehavior;
