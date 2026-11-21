import "server-only";

import type {
  OAuthCodeConnectInput,
  ProviderBehavior,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
  ProviderToolInput,
  ProviderToolResult,
} from "./types";
import { isJsonObject, toJsonObject } from "@/lib/utils/jsonObject";
import { normalizeSubredditName } from "@/lib/platforms/subredditName";

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

/**
 * Reddit provider. OAuth2 with duration=permanent so a refresh token is
 * issued; Reddit access tokens live one hour. Token endpoint wants HTTP
 * Basic client auth, and API calls go to oauth.reddit.com with a distinct
 * User-Agent (Reddit throttles the default ones hard).
 *
 * sourceRef: reddit.com/dev/api (api/v1/me, api/submit, link_flair_v2).
 */

const REDDIT_TIMEOUT_MS = 20_000;
const REDDIT_USER_AGENT = "web:com.sharetopus:v1.0 (by /u/sharetopus)";

const REDDIT_OAUTH: OAuth2Config = {
  authorizeUrl: "https://www.reddit.com/api/v1/authorize",
  tokenUrl: "https://www.reddit.com/api/v1/access_token",
  clientIdEnv: "REDDIT_CLIENT_ID",
  clientSecretEnv: "REDDIT_CLIENT_SECRET",
  scope: "identity submit flair read",
  extraAuthorizeParams: { duration: "permanent" },
  useBasicAuthForToken: true,
};

async function redditApiGet(
  accessToken: string,
  path: string,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  const result = await providerFetch(`https://oauth.reddit.com${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": REDDIT_USER_AGENT,
    },
    timeoutMs: REDDIT_TIMEOUT_MS,
  });
  if (!result.ok) return { ok: false, message: result.message };
  if (result.status !== 200) {
    return { ok: false, message: `Reddit ${path} failed (${result.status}).` };
  }
  return { ok: true, body: parseJsonBody(result.bodyText) };
}

async function connect(
  input: OAuthCodeConnectInput,
): Promise<ProviderConnectResult> {
  const tokens = await exchangeOAuth2Code(REDDIT_OAUTH, input);
  if (!tokens.ok) return { ok: false, message: tokens.message };

  const me = await redditApiGet(tokens.accessToken, "/api/v1/me");
  if (!me.ok) return { ok: false, message: me.message };

  const username = readStringField(me.body, "name");
  if (!username) {
    return { ok: false, message: "Reddit returned no username." };
  }

  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    identity: {
      accountIdentifier: username,
      displayName: username,
      username,
      avatarUrl: readStringField(me.body, "icon_img"),
    },
    config: {},
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const subreddit = normalizeSubredditName(input.options.subreddit ?? "");
  if (!subreddit) {
    return refusePublish("A valid subreddit name is required (options.subreddit).");
  }
  const title = input.title.trim();
  if (!title) return refusePublish("Reddit posts require a title.");

  // Self post for text; link post pointing at the media URL otherwise
  // (Reddit's media upload API is not public, so link is the honest form).
  const isTextPost = input.postType === "text" || !input.mediaUrl;
  const form = new URLSearchParams({
    api_type: "json",
    sr: subreddit,
    title,
    kind: isTextPost ? "self" : "link",
    ...(isTextPost ? { text: input.body } : { url: input.mediaUrl ?? "" }),
  });
  if (input.options.flairId) form.set("flair_id", input.options.flairId);

  const result = await providerFetch("https://oauth.reddit.com/api/submit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "User-Agent": REDDIT_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    timeoutMs: REDDIT_TIMEOUT_MS,
  });

  if (!result.ok) {
    return failProviderFetch({ platform: "reddit", stage: "publish", fetchFailure: result });
  }
  if (result.status !== 200) {
    return failHttpAnswer({
      platform: "reddit",
      stage: "publish",
      action: "Reddit submit",
      httpStatus: result.status,
      bodyText: result.bodyText,
    });
  }

  const jsonEnvelope = toJsonObject(parseJsonObject(result.bodyText)?.json);
  const submitErrors: unknown[] = Array.isArray(jsonEnvelope?.errors)
    ? jsonEnvelope.errors
    : [];
  const firstSubmitError = submitErrors[0];
  if (firstSubmitError !== undefined) {
    const firstErrorCode = Array.isArray(firstSubmitError) ? firstSubmitError[0] : null;
    return failPublish({
      message: `Reddit rejected the post: ${JSON.stringify(firstSubmitError).slice(0, 200)}`,
      reason: firstErrorCode === "RATELIMIT" ? "rate_limited" : "invalid_input",
      mayHavePublished: false,
    });
  }
  const submitData = toJsonObject(jsonEnvelope?.data);
  const postName = submitData && typeof submitData.name === "string" ? submitData.name : null;
  if (!postName) {
    return failUnreadableAnswer({ message: "Reddit returned no post id.", stage: "publish" });
  }

  return {
    ok: true,
    postId: postName,
    postUrl:
      submitData && typeof submitData.url === "string" ? submitData.url : null,
  };
}

async function runTool(input: ProviderToolInput): Promise<ProviderToolResult> {
  if (input.methodName !== "listFlairs") {
    return { ok: false, message: `Unknown Reddit tool "${input.methodName}".` };
  }
  const subreddit =
    typeof input.parameters.subreddit === "string"
      ? normalizeSubredditName(input.parameters.subreddit)
      : null;
  if (!subreddit) return { ok: false, message: "A valid subreddit name is required." };

  const flairs = await redditApiGet(
    input.accessToken,
    `/r/${subreddit}/api/link_flair_v2`,
  );
  if (!flairs.ok) return { ok: false, message: flairs.message };

  const flairRows: unknown[] = Array.isArray(flairs.body) ? flairs.body : [];
  const list = flairRows.filter(isJsonObject).map((flair) => ({
    id: typeof flair.id === "string" ? flair.id : null,
    text: typeof flair.text === "string" ? flair.text : null,
  }));
  return { ok: true, data: { flairs: list } };
}

export const redditBehavior = {
  authKind: "oauth2",
  connect,
  publish,
  refresh: (input) => refreshOAuth2Credential(REDDIT_OAUTH, input),
  // The refresh token from the first grant keeps working:
  // https://github.com/reddit-archive/reddit/wiki/OAuth2 (Refreshing the token)
  refreshTokenRotation: "stable",
  runTool,
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(REDDIT_OAUTH, input),
} satisfies ProviderBehavior;
