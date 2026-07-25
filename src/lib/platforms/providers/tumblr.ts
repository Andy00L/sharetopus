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
 * Tumblr provider. OAuth2 with refresh tokens; posts use the Neue Post
 * Format (content blocks). The user's primary blog is stored at connect
 * and a listBlogs tool lets an agent target another one.
 *
 * sourceRef: tumblr.com/docs/en/api/v2 (oauth2, user/info, blog posts NPF).
 */

const TUMBLR_API = "https://api.tumblr.com/v2";
const TUMBLR_TIMEOUT_MS = 20_000;

const TUMBLR_OAUTH: OAuth2Config = {
  authorizeUrl: "https://www.tumblr.com/oauth2/authorize",
  tokenUrl: "https://api.tumblr.com/v2/oauth2/token",
  clientIdEnv: "TUMBLR_CLIENT_ID",
  clientSecretEnv: "TUMBLR_CLIENT_SECRET",
  scope: "basic write offline_access",
  useBasicAuthForToken: false,
};

async function fetchUserInfo(
  accessToken: string,
): Promise<
  | { ok: true; name: string; blogs: { name: string; title: string | null }[] }
  | { ok: false; message: string }
> {
  const result = await providerFetch(`${TUMBLR_API}/user/info`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    timeoutMs: TUMBLR_TIMEOUT_MS,
  });
  if (!result.ok) return { ok: false, message: result.message };
  if (result.status !== 200) {
    return { ok: false, message: `Tumblr user/info failed (${result.status}).` };
  }

  const parsed = parseJsonBody(result.bodyText) as Record<string, unknown> | null;
  const response =
    parsed && typeof parsed.response === "object" && parsed.response !== null
      ? (parsed.response as Record<string, unknown>)
      : null;
  const user =
    response && typeof response.user === "object" && response.user !== null
      ? (response.user as Record<string, unknown>)
      : null;
  const userName = user && typeof user.name === "string" ? user.name : null;
  if (!userName) return { ok: false, message: "Tumblr returned no user name." };

  const blogs = Array.isArray(user?.blogs)
    ? user.blogs
        .filter(
          (blog): blog is Record<string, unknown> =>
            typeof blog === "object" && blog !== null,
        )
        .map((blog) => ({
          name: typeof blog.name === "string" ? blog.name : "",
          title: typeof blog.title === "string" ? blog.title : null,
        }))
        .filter((blog) => blog.name.length > 0)
    : [];

  return { ok: true, name: userName, blogs };
}

async function connect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "oauth_code") {
    return { ok: false, message: "Tumblr connects through OAuth." };
  }

  const tokens = await exchangeOAuth2Code(TUMBLR_OAUTH, input);
  if (!tokens.ok) return { ok: false, message: tokens.message };

  const userInfo = await fetchUserInfo(tokens.accessToken);
  if (!userInfo.ok) return { ok: false, message: userInfo.message };

  const primaryBlog = userInfo.blogs[0]?.name ?? userInfo.name;

  return {
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    identity: {
      accountIdentifier: userInfo.name,
      displayName: userInfo.name,
      username: userInfo.name,
      avatarUrl: null,
    },
    config: { blogIdentifier: primaryBlog },
  };
}

async function refresh(refreshToken: string): Promise<ProviderConnectResult> {
  const tokens = await refreshOAuth2Token(TUMBLR_OAUTH, refreshToken);
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

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const blogIdentifier =
    typeof input.options.blog === "string" && input.options.blog.trim()
      ? input.options.blog.trim()
      : typeof input.config.blogIdentifier === "string"
        ? input.config.blogIdentifier
        : null;
  if (!blogIdentifier) {
    return { ok: false, message: "Stored Tumblr account has no blog." };
  }

  // NPF content blocks: optional media block, then the text.
  const contentBlocks: Record<string, unknown>[] = [];
  if (input.mediaType === "image" && input.mediaUrl) {
    contentBlocks.push({
      type: "image",
      media: [{ type: input.mediaMimeType, url: input.mediaUrl }],
    });
  } else if (input.mediaType === "video" && input.mediaUrl) {
    contentBlocks.push({ type: "video", url: input.mediaUrl });
  }
  if (input.title.trim()) {
    contentBlocks.push({
      type: "text",
      subtype: "heading1",
      text: input.title.trim(),
    });
  }
  if (input.body.trim()) {
    contentBlocks.push({ type: "text", text: input.body.trim() });
  }
  if (contentBlocks.length === 0) {
    return { ok: false, message: "Tumblr post has no content." };
  }

  const result = await providerFetch(
    `${TUMBLR_API}/blog/${encodeURIComponent(blogIdentifier)}/posts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({ content: contentBlocks, state: "published" }),
      timeoutMs: TUMBLR_TIMEOUT_MS,
    },
  );

  if (!result.ok) return { ok: false, message: result.message };
  if (result.status !== 201 && result.status !== 200) {
    return {
      ok: false,
      message: `Tumblr post failed (${result.status}): ${result.bodyText.slice(0, 300)}`,
    };
  }

  const parsed = parseJsonBody(result.bodyText) as Record<string, unknown> | null;
  const response =
    parsed && typeof parsed.response === "object" && parsed.response !== null
      ? (parsed.response as Record<string, unknown>)
      : null;
  const postId =
    response && (typeof response.id === "string" || typeof response.id === "number")
      ? String(response.id)
      : readStringField(response, "id_string");
  if (!postId) return { ok: false, message: "Tumblr returned no post id." };

  return {
    ok: true,
    postId,
    postUrl: `https://${blogIdentifier}.tumblr.com/post/${postId}`,
  };
}

async function runTool(input: ProviderToolInput): Promise<ProviderToolResult> {
  if (input.methodName !== "listBlogs") {
    return { ok: false, message: `Unknown Tumblr tool "${input.methodName}".` };
  }
  const userInfo = await fetchUserInfo(input.accessToken);
  if (!userInfo.ok) return { ok: false, message: userInfo.message };
  return { ok: true, data: { blogs: userInfo.blogs } };
}

export const tumblrBehavior: ProviderBehavior = {
  connect,
  publish,
  refresh,
  runTool,
  buildAuthorizeUrl: (input) => buildOAuth2AuthorizeUrl(TUMBLR_OAUTH, input),
};
