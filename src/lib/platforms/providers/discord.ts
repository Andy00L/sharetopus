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

/**
 * Discord provider, webhook mode.
 *
 * A channel webhook needs no bot, no OAuth app, and no review: the user
 * copies one URL from channel settings and the connection works. The
 * webhook URL is both the credential and the target, so it is stored in
 * access_token and never logged.
 *
 * sourceRef: discord.com/developers/docs/resources/webhook (Get Webhook
 * with Token, Execute Webhook).
 */

const DISCORD_TIMEOUT_MS = 20_000;

/**
 * Hosts a Discord webhook may live on. The URL is pasted by the user, so
 * without this check "webhook URL" would be an open request-forgery field
 * pointed at any host we can reach. providerFetch already blocks private
 * addresses; this additionally pins the provider to Discord itself.
 */
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
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return { ok: false, message: "Discord connects with a webhook URL." };
  }

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
    // Webhook tokens do not expire; null stops ensureValidToken from
    // trying to refresh something that has no refresh flow.
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
  // Re-validate on every send: the stored value is the posting target, and
  // a row edited by any other path must not become a request forgery.
  const validation = validateWebhookUrl(input.accessToken);
  if (!validation.ok) return { ok: false, message: validation.message };

  const content = buildContent(input);

  const payload: Record<string, unknown> = { content };

  // Discord renders an image from an embed URL, so media needs no upload:
  // it fetches our signed URL itself. Video is not embeddable, so the URL
  // goes in the message body where Discord unfurls it.
  if (input.mediaType === "image" && input.mediaUrl) {
    payload.embeds = [{ image: { url: input.mediaUrl } }];
  } else if (input.mediaType === "video" && input.mediaUrl) {
    payload.content = `${content}\n${input.mediaUrl}`.slice(0, 2000);
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

  if (!sendResult.ok) return { ok: false, message: sendResult.message };

  if (sendResult.status === 429) {
    // Distinct wording so the worker's classifier routes this to the
    // retryable path instead of failing the post outright.
    return { ok: false, message: "Discord rate limit reached (429)." };
  }
  if (sendResult.status !== 200) {
    return {
      ok: false,
      message: `Discord webhook post failed (${sendResult.status}): ${sendResult.bodyText.slice(0, 300)}`,
    };
  }

  const message = parseJsonBody(sendResult.bodyText);
  const messageId = readStringField(message, "id");
  if (!messageId) {
    return { ok: false, message: "Discord returned no message id." };
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

/** Discord has no title field, so a title becomes a bold first line. */
function buildContent(input: ProviderPublishInput): string {
  const trimmedTitle = input.title.trim();
  const trimmedBody = input.body.trim();
  const combined = !trimmedTitle
    ? trimmedBody
    : !trimmedBody
      ? `**${trimmedTitle}**`
      : `**${trimmedTitle}**\n\n${trimmedBody}`;
  return combined.slice(0, 2000);
}

export const discordBehavior: ProviderBehavior = { connect, publish };
