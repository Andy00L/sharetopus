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
 * Slack provider, bot-token mode.
 *
 * The user creates an app in their own workspace, gives it chat:write, and
 * pastes the bot token. No OAuth app of ours and no review, so it works as
 * soon as the token exists. Bot tokens do not expire, hence no refresh.
 *
 * sourceRef: api.slack.com/methods (auth.test, chat.postMessage,
 * conversations.list).
 */

const SLACK_API_ORIGIN = "https://slack.com/api";
const SLACK_TIMEOUT_MS = 20_000;

/**
 * Calls one Web API method. Slack answers HTTP 200 even for errors and
 * signals failure with {ok:false, error}, so the envelope is what matters.
 */
async function callSlackApi(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
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
    return { ok: false, message: `Slack ${method} failed: ${callResult.message}` };
  }

  const parsed = parseJsonBody(callResult.bodyText);
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, message: `Slack ${method} returned no JSON.` };
  }

  const envelope = parsed as Record<string, unknown>;
  if (envelope.ok !== true) {
    // Slack's error slugs are actionable verbatim: not_in_channel,
    // channel_not_found, invalid_auth, missing_scope.
    const errorSlug =
      typeof envelope.error === "string" ? envelope.error : "unknown_error";
    return { ok: false, message: `Slack ${method} failed: ${errorSlug}` };
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
      // The channel is the posting target, so it identifies the connection;
      // one token can serve several channels as separate connections.
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
    return { ok: false, message: "Stored Slack account is missing its channel." };
  }

  const messageText = buildMessageText(input);

  const payload: Record<string, unknown> = {
    channel: channelId,
    text: messageText,
  };

  // Slack renders an image from a block using our signed URL, so no upload
  // is needed. Video is not renderable as a block; the URL goes in the text
  // where Slack unfurls it.
  if (input.mediaType === "image" && input.mediaUrl) {
    payload.blocks = [
      { type: "section", text: { type: "mrkdwn", text: messageText } },
      {
        type: "image",
        image_url: input.mediaUrl,
        alt_text: input.title || "Attached image",
      },
    ];
  } else if (input.mediaType === "video" && input.mediaUrl) {
    payload.text = `${messageText}\n${input.mediaUrl}`;
  }

  const postResult = await callSlackApi(
    input.accessToken,
    "chat.postMessage",
    payload,
  );
  if (!postResult.ok) return { ok: false, message: postResult.message };

  const messageTimestamp =
    typeof postResult.body.ts === "string" ? postResult.body.ts : null;
  if (!messageTimestamp) {
    return { ok: false, message: "Slack returned no message timestamp." };
  }

  return {
    ok: true,
    // Slack identifies a message by its channel plus ts, so both are needed
    // to address it later.
    postId: `${channelId}:${messageTimestamp}`,
    postUrl: null,
  };
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
    .filter(
      (channel): channel is Record<string, unknown> =>
        typeof channel === "object" && channel !== null,
    )
    .map((channel) => ({
      id: typeof channel.id === "string" ? channel.id : null,
      name: typeof channel.name === "string" ? channel.name : null,
      isMember: channel.is_member === true,
    }));

  return { ok: true, data: { channels } };
}

export const slackBehavior: ProviderBehavior = { connect, publish, runTool };
