import "server-only";

import type {
  ProviderBehavior,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderPublishFailure,
  ProviderPublishInput,
  ProviderPublishResult,
  ProviderToolInput,
  ProviderToolResult,
} from "./types";
import type { PlatformFailure } from "@/lib/api/_shared/platformFailure";
import { isJsonObject } from "@/lib/utils/jsonObject";

import {
  parseJsonObject,
  providerFetch,
  type ProviderFetchFailure,
} from "./_shared/providerFetch";
import {
  classifyHttpAnswer,
  failProviderFetch,
  failUnreadableAnswer,
  refusePublish,
} from "./_shared/publishFailure";
import { splitTextIntoChunks } from "./_shared/textLimits";

/**
 * Bot tokens do not expire, hence no refresh.
 *
 * sourceRef: api.slack.com/methods (auth.test, chat.postMessage,
 * conversations.list).
 */

const SLACK_API_ORIGIN = "https://slack.com/api";
const SLACK_TIMEOUT_MS = 20_000;

// docs.slack.dev/reference/block-kit/blocks/section-block: section `text`
// "maximum length is 3000 characters"; image-block `alt_text` "Maximum length
// for this field is 2000 characters".
const SECTION_TEXT_MAX_CHARS = 3000;
const IMAGE_ALT_TEXT_MAX_CHARS = 2000;

const AUTH_EXPIRED: PlatformFailure = { reason: "auth_expired", mayHavePublished: false };
const POLICY_REJECTED: PlatformFailure = { reason: "policy_rejected", mayHavePublished: false };
const INVALID_INPUT: PlatformFailure = { reason: "invalid_input", mayHavePublished: false };
const RATE_LIMITED: PlatformFailure = { reason: "rate_limited", mayHavePublished: false };
const TRANSIENT: PlatformFailure = { reason: "transient", mayHavePublished: false };
const MAY_HAVE_POSTED: PlatformFailure = { reason: "unknown", mayHavePublished: true };

// docs.slack.dev/reference/methods/chat.postMessage (Errors). internal_error
// and fatal_error: "It's possible some aspect of the operation succeeded".
const CHAT_POST_FAILURE_BY_ERROR = new Map<string, PlatformFailure>([
  ["ratelimited", RATE_LIMITED],
  ["rate_limited", RATE_LIMITED],
  ["invalid_auth", AUTH_EXPIRED],
  ["not_authed", AUTH_EXPIRED],
  ["token_revoked", AUTH_EXPIRED],
  ["token_expired", AUTH_EXPIRED],
  ["account_inactive", AUTH_EXPIRED],
  ["missing_scope", AUTH_EXPIRED],
  ["team_access_not_granted", AUTH_EXPIRED],
  ["no_permission", AUTH_EXPIRED],
  ["channel_not_found", POLICY_REJECTED],
  ["not_in_channel", POLICY_REJECTED],
  ["is_archived", POLICY_REJECTED],
  ["restricted_action", POLICY_REJECTED],
  ["msg_blocks_too_long", INVALID_INPUT],
  ["invalid_blocks", INVALID_INPUT],
  ["no_text", INVALID_INPUT],
  ["service_unavailable", TRANSIENT],
  ["request_timeout", TRANSIENT],
  ["internal_error", MAY_HAVE_POSTED],
  ["fatal_error", MAY_HAVE_POSTED],
]);

type SlackApiFailure =
  | { ok: false; kind: "fetch"; message: string; fetchFailure: ProviderFetchFailure }
  | { ok: false; kind: "error_slug"; message: string; errorSlug: string }
  | { ok: false; kind: "unreadable"; message: string; httpStatus: number; bodyText: string };

/**
 * Calls one Web API method. Slack answers HTTP 200 even for errors and
 * signals failure with {ok:false, error}, so the envelope is what matters.
 */
async function callSlackApi(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; body: Record<string, unknown> } | SlackApiFailure> {
  const callResult = await providerFetch(`${SLACK_API_ORIGIN}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(payload),
    timeoutMs: SLACK_TIMEOUT_MS,
  });

  if (!callResult.ok) {
    return {
      ok: false,
      kind: "fetch",
      message: `Slack ${method} failed: ${callResult.message}`,
      fetchFailure: callResult,
    };
  }

  const envelope = parseJsonObject(callResult.bodyText);
  if (!envelope) {
    return {
      ok: false,
      kind: "unreadable",
      message: `Slack ${method} returned no JSON (HTTP ${callResult.status}).`,
      httpStatus: callResult.status,
      bodyText: callResult.bodyText,
    };
  }

  if (envelope.ok !== true) {
    const errorSlug =
      typeof envelope.error === "string" ? envelope.error : "unknown_error";
    return {
      ok: false,
      kind: "error_slug",
      message: `Slack ${method} failed: ${errorSlug}`,
      errorSlug,
    };
  }

  return { ok: true, body: envelope };
}

async function connect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return { ok: false, message: "Slack connects with a bot token." };
  }

  const botToken = (input.values.botToken ?? "").trim();
  const channelId = (input.values.channelId ?? "").trim();

  if (!botToken || !channelId) {
    return { ok: false, message: "Bot token and channel are both required." };
  }

  const authResult = await callSlackApi(botToken, "auth.test", {});
  if (!authResult.ok) return { ok: false, message: authResult.message };

  const teamId =
    typeof authResult.body.team_id === "string" ? authResult.body.team_id : null;
  const teamName =
    typeof authResult.body.team === "string" ? authResult.body.team : null;
  const botUserId =
    typeof authResult.body.user_id === "string" ? authResult.body.user_id : null;

  if (!teamId) {
    return { ok: false, message: "Slack auth.test returned no team id." };
  }

  return {
    ok: true,
    accessToken: botToken,
    refreshToken: null,
    expiresIn: null,
    identity: {
      accountIdentifier: `${teamId}:${channelId}`,
      displayName: teamName ? `${teamName} (${channelId})` : channelId,
      username: teamName,
      avatarUrl: null,
    },
    config: { channelId, teamId, botUserId },
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const channelId =
    typeof input.config.channelId === "string" ? input.config.channelId : null;
  if (!channelId) {
    return refusePublish("Stored Slack account is missing its channel.");
  }

  const messageText = buildMessageText(input);

  const payload: Record<string, unknown> = {
    channel: channelId,
    text: messageText,
  };

  // Slack renders an image from a block using our signed URL, so no upload
  // is needed.
  if (input.postType === "image" && input.mediaUrl) {
    payload.blocks = [
      ...splitTextIntoChunks(messageText, SECTION_TEXT_MAX_CHARS).map((sectionText) => ({
        type: "section",
        text: { type: "mrkdwn", text: sectionText },
      })),
      {
        type: "image",
        image_url: input.mediaUrl,
        alt_text: (input.title.trim() || "Attached image").slice(0, IMAGE_ALT_TEXT_MAX_CHARS),
      },
    ];
  } else if (input.postType === "video" && input.mediaUrl) {
    payload.text = `${messageText}\n${input.mediaUrl}`;
  }

  const postResult = await callSlackApi(
    input.accessToken,
    "chat.postMessage",
    payload,
  );
  if (!postResult.ok) return failChatPost(postResult);

  const messageTimestamp =
    typeof postResult.body.ts === "string" ? postResult.body.ts : null;
  if (!messageTimestamp) {
    return failUnreadableAnswer({
      message: "Slack returned no message timestamp.",
      stage: "publish",
    });
  }

  return {
    ok: true,
    // Slack identifies a message by its channel plus ts, so both are needed
    // to address it later.
    postId: `${channelId}:${messageTimestamp}`,
    postUrl: null,
  };
}

function failChatPost(callFailure: SlackApiFailure): ProviderPublishFailure {
  switch (callFailure.kind) {
    case "fetch":
      return {
        ...failProviderFetch({
          platform: "slack",
          stage: "publish",
          fetchFailure: callFailure.fetchFailure,
        }),
        message: callFailure.message,
      };
    case "error_slug":
      return {
        ok: false,
        message: callFailure.message,
        failure: CHAT_POST_FAILURE_BY_ERROR.get(callFailure.errorSlug) ?? {
          reason: "unknown",
          mayHavePublished: false,
        },
      };
    case "unreadable":
      return {
        ok: false,
        message: callFailure.message,
        failure: classifyHttpAnswer({
          platform: "slack",
          stage: "publish",
          httpStatus: callFailure.httpStatus,
          bodyText: callFailure.bodyText,
        }),
      };
    default: {
      const unhandledFailure: never = callFailure;
      return {
        ok: false,
        message: `Unhandled Slack failure: ${String(unhandledFailure)}`,
        failure: MAY_HAVE_POSTED,
      };
    }
  }
}

/** Slack has no title field, so a title becomes a bold first line. */
function buildMessageText(input: ProviderPublishInput): string {
  const trimmedTitle = input.title.trim();
  const trimmedBody = input.body.trim();
  if (!trimmedTitle) return trimmedBody;
  if (!trimmedBody) return `*${trimmedTitle}*`;
  return `*${trimmedTitle}*\n\n${trimmedBody}`;
}

async function runTool(input: ProviderToolInput): Promise<ProviderToolResult> {
  if (input.methodName !== "listChannels") {
    return { ok: false, message: `Unknown Slack tool "${input.methodName}".` };
  }

  const listResult = await callSlackApi(
    input.accessToken,
    "conversations.list",
    { limit: 200, exclude_archived: true, types: "public_channel" },
  );
  if (!listResult.ok) return { ok: false, message: listResult.message };

  const rawChannels = listResult.body.channels;
  if (!Array.isArray(rawChannels)) {
    return { ok: false, message: "Slack returned no channel list." };
  }

  const channels = rawChannels
    .filter(isJsonObject)
    .map((channel) => ({
      id: typeof channel.id === "string" ? channel.id : null,
      name: typeof channel.name === "string" ? channel.name : null,
      isMember: channel.is_member === true,
    }));

  return { ok: true, data: { channels } };
}

export const slackBehavior: ProviderBehavior = { connect, publish, runTool };
