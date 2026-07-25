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
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "oauth_code") {
    return { ok: false, message: "Reddit connects through OAuth." };
  }

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

async function refresh(refreshToken: string): Promise<ProviderConnectResult> {
  const tokens = await refreshOAuth2Token(REDDIT_OAUTH, refreshToken);
  if (!tokens.ok) return { ok: false, message: tokens.message };

  const me = await redditApiGet(tokens.accessToken, "/api/v1/me");
  const username = me.ok ? readStringField(me.body, "name") : null;

  return {
    ok: true,
    accessToken: tokens.accessToken,
    // Reddit keeps the same refresh token unless it returns a new one.
    refreshToken: tokens.refreshToken ?? refreshToken,
    expiresIn: tokens.expiresIn,
    identity: {
      accountIdentifier: username ?? "unknown",
      displayName: username,
      username,
      avatarUrl: null,
    },
    config: {},
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const subreddit =
    typeof input.options.subreddit === "string"
      ? input.options.subreddit.trim().replace(/^r\//, "")
      : "";
  if (!subreddit) {
    return { ok: false, message: "A subreddit is required (options.subreddit)." };
  }
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Reddit posts require a title." };

  // Self post for text; link post pointing at the media URL otherwise
  // (Reddit's media upload API is not public, so link is the honest form).
  const isTextPost = input.mediaType === "text" || !input.mediaUrl;
  const form = new URLSearchParams({
    api_type: "json",
    sr: subreddit,
    title,
    kind: isTextPost ? "self" : "link",
    ...(isTextPost ? { text: input.body } : { url: input.mediaUrl ?? "" }),
  });
  const flairId =
    typeof input.options.flairId === "string" ? input.options.flairId : null;
  if (flairId) form.set("flair_id", flairId);

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

  if (!result.ok) return { ok: false, message: result.message };
  if (result.status === 429) {
    return { ok: false, message: "Reddit rate limit reached (429)." };
  }
  if (result.status !== 200) {
    return {
      ok: false,
      message: `Reddit submit failed (${result.status}): ${result.bodyText.slice(0, 300)}`,
    };
  }

  // Response shape: { json: { errors: [...], data: { id, url, name } } }
  const parsed = parseJsonBody(result.bodyText) as Record<string, unknown> | null;
  const jsonEnvelope =
    parsed && typeof parsed.json === "object" && parsed.json !== null
      ? (parsed.json as Record<string, unknown>)
      : null;
  const submitErrors = Array.isArray(jsonEnvelope?.errors)
    ? jsonEnvelope.errors
    : [];
  if (submitErrors.length > 0) {
    return {
      ok: false,
      message: `Reddit rejected the post: ${JSON.stringify(submitErrors[0]).slice(0, 200)}`,
    };
  }
  const submitData =
    jsonEnvelope && typeof jsonEnvelope.data === "object"
      ? (jsonEnvelope.data as Record<string, unknown>)
      : null;
  const postName = submitData && typeof submitData.name === "string" ? submitData.name : null;
  if (!postName) {
    return { ok: false, message: "Reddit returned no post id." };
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
      ? input.parameters.subreddit.trim().replace(/^r\//, "")
      : "";
  if (!subreddit) return { ok: false, message: "subreddit is required." };
  // The subreddit lands in a URL path; restrict to Reddit's own name rules
  // so it cannot smuggle path segments.
  if (!/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) {
    return { ok: false, message: "That is not a valid subreddit name." };
  }

  const flairs = await redditApiGet(
    input.accessToken,
    `/r/${subreddit}/api/link_flair_v2`,
  );
  if (!flairs.ok) return { ok: false, message: flairs.message };

  const list = Array.isArray(flairs.body)
    ? flairs.body
        .filter(
          (flair): flair is Record<string, unknown> =>
            typeof flair === "object" && flair !== null,
        )
        .map((flair) => ({
          id: typeof flair.id === "string" ? flair.id : null,
          text: typeof flair.text === "string" ? flair.text : null,
        }))
    : [];
  return { ok: true, data: { flairs: list } };
}

export const redditBehavior: ProviderBehavior = {
  connect,
  publish,
  refresh,
  runTool,
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(REDDIT_OAUTH, input),
};
