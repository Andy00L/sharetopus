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

/**
 * Credentials-based long-form providers: Hashnode, Medium, Lemmy.
 * Grouped in one module because each is a compact single-credential API.
 *
 * sourceRef: apidocs.hashnode.com (gql.hashnode.com publishPost),
 * github.com/Medium/medium-api-docs (v1/me, users/{id}/posts),
 * join-lemmy.org/api (user/login, post, community/list).
 */

const BLOG_TIMEOUT_MS = 30_000;

// ── Hashnode ──────────────────────────────────────────────────────────────

const HASHNODE_GQL = "https://gql.hashnode.com";

async function hashnodeGql(
  apiToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
  const result = await providerFetch(HASHNODE_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiToken,
    },
    body: JSON.stringify({ query, variables }),
    timeoutMs: BLOG_TIMEOUT_MS,
  });
  if (!result.ok) return { ok: false, message: result.message };
  const parsed = parseJsonBody(result.bodyText) as Record<string, unknown> | null;
  const gqlErrors = Array.isArray(parsed?.errors) ? parsed.errors : [];
  if (gqlErrors.length > 0) {
    const firstError =
      typeof gqlErrors[0] === "object" && gqlErrors[0] !== null
        ? ((gqlErrors[0] as Record<string, unknown>).message ?? "GraphQL error")
        : "GraphQL error";
    return { ok: false, message: `Hashnode: ${String(firstError).slice(0, 200)}` };
  }
  const data =
    parsed && typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : null;
  if (!data) return { ok: false, message: "Hashnode returned no data." };
  return { ok: true, data };
}

async function hashnodeConnect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return { ok: false, message: "Hashnode connects with an API token." };
  }
  const apiToken = (input.values.apiToken ?? "").trim();
  if (!apiToken) return { ok: false, message: "API token is required." };

  const me = await hashnodeGql(
    apiToken,
    `query Me { me { id username name profilePicture publications(first: 1) { edges { node { id title } } } } }`,
    {},
  );
  if (!me.ok) return { ok: false, message: me.message };

  const meNode =
    typeof me.data.me === "object" && me.data.me !== null
      ? (me.data.me as Record<string, unknown>)
      : null;
  const userId = meNode && typeof meNode.id === "string" ? meNode.id : null;
  if (!userId) return { ok: false, message: "Hashnode token is not valid." };

  // Default publication: the first one on the account. listPublications
  // lets an agent pick another.
  const publications =
    meNode && typeof meNode.publications === "object" && meNode.publications !== null
      ? (meNode.publications as Record<string, unknown>)
      : null;
  const edges = Array.isArray(publications?.edges) ? publications.edges : [];
  const firstEdge =
    edges[0] && typeof edges[0] === "object"
      ? (edges[0] as Record<string, unknown>)
      : null;
  const firstNode =
    firstEdge && typeof firstEdge.node === "object" && firstEdge.node !== null
      ? (firstEdge.node as Record<string, unknown>)
      : null;
  const publicationId =
    firstNode && typeof firstNode.id === "string" ? firstNode.id : null;

  return {
    ok: true,
    accessToken: apiToken,
    refreshToken: null,
    expiresIn: null,
    identity: {
      accountIdentifier: userId,
      displayName: readStringField(meNode, "name"),
      username: readStringField(meNode, "username"),
      avatarUrl: readStringField(meNode, "profilePicture"),
    },
    config: { publicationId },
  };
}

async function hashnodePublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const publicationId =
    typeof input.options.publicationId === "string" && input.options.publicationId
      ? input.options.publicationId
      : typeof input.config.publicationId === "string"
        ? input.config.publicationId
        : null;
  if (!publicationId) {
    return { ok: false, message: "Hashnode account has no publication." };
  }
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Hashnode posts require a title." };

  const markdown =
    input.mediaType === "image" && input.mediaUrl
      ? `![${title}](${input.mediaUrl})\n\n${input.body}`
      : input.body;

  const published = await hashnodeGql(
    input.accessToken,
    `mutation Publish($input: PublishPostInput!) {
       publishPost(input: $input) { post { id url } }
     }`,
    { input: { title, contentMarkdown: markdown, publicationId } },
  );
  if (!published.ok) return { ok: false, message: published.message };

  const publishPost =
    typeof published.data.publishPost === "object" && published.data.publishPost !== null
      ? (published.data.publishPost as Record<string, unknown>)
      : null;
  const post =
    publishPost && typeof publishPost.post === "object" && publishPost.post !== null
      ? (publishPost.post as Record<string, unknown>)
      : null;
  const postId = post && typeof post.id === "string" ? post.id : null;
  if (!postId) return { ok: false, message: "Hashnode returned no post id." };

  return {
    ok: true,
    postId,
    postUrl: post && typeof post.url === "string" ? post.url : null,
  };
}

async function hashnodeRunTool(
  input: ProviderToolInput,
): Promise<ProviderToolResult> {
  if (input.methodName !== "listPublications") {
    return { ok: false, message: `Unknown Hashnode tool "${input.methodName}".` };
  }
  const me = await hashnodeGql(
    input.accessToken,
    `query Pubs { me { publications(first: 20) { edges { node { id title url } } } } }`,
    {},
  );
  if (!me.ok) return { ok: false, message: me.message };

  const meNode =
    typeof me.data.me === "object" && me.data.me !== null
      ? (me.data.me as Record<string, unknown>)
      : null;
  const publications =
    meNode && typeof meNode.publications === "object" && meNode.publications !== null
      ? (meNode.publications as Record<string, unknown>)
      : null;
  const edges = Array.isArray(publications?.edges) ? publications.edges : [];
  const list = edges
    .map((edge) =>
      typeof edge === "object" && edge !== null
        ? (edge as Record<string, unknown>).node
        : null,
    )
    .filter(
      (node): node is Record<string, unknown> =>
        typeof node === "object" && node !== null,
    )
    .map((node) => ({
      id: typeof node.id === "string" ? node.id : null,
      title: typeof node.title === "string" ? node.title : null,
      url: typeof node.url === "string" ? node.url : null,
    }));
  return { ok: true, data: { publications: list } };
}

export const hashnodeBehavior: ProviderBehavior = {
  connect: hashnodeConnect,
  publish: hashnodePublish,
  runTool: hashnodeRunTool,
};

// ── Medium ────────────────────────────────────────────────────────────────

const MEDIUM_API = "https://api.medium.com/v1";

async function mediumConnect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return { ok: false, message: "Medium connects with an integration token." };
  }
  const integrationToken = (input.values.integrationToken ?? "").trim();
  if (!integrationToken) {
    return { ok: false, message: "Integration token is required." };
  }

  const meResult = await providerFetch(`${MEDIUM_API}/me`, {
    method: "GET",
    headers: { Authorization: `Bearer ${integrationToken}` },
    timeoutMs: BLOG_TIMEOUT_MS,
  });
  if (!meResult.ok) return { ok: false, message: meResult.message };
  if (meResult.status !== 200) {
    return {
      ok: false,
      message: `Medium rejected the token (HTTP ${meResult.status}). Note that Medium stopped issuing new integration tokens; only existing ones work.`,
    };
  }

  const parsed = parseJsonBody(meResult.bodyText) as Record<string, unknown> | null;
  const data =
    parsed && typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : null;
  const userId = data && typeof data.id === "string" ? data.id : null;
  if (!userId) return { ok: false, message: "Medium returned no user id." };

  return {
    ok: true,
    accessToken: integrationToken,
    refreshToken: null,
    expiresIn: null,
    identity: {
      accountIdentifier: userId,
      displayName: readStringField(data, "name"),
      username: readStringField(data, "username"),
      avatarUrl: readStringField(data, "imageUrl"),
    },
    config: { userId },
  };
}

async function mediumPublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const userId =
    typeof input.config.userId === "string"
      ? input.config.userId
      : input.accountIdentifier;
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Medium posts require a title." };

  const markdown =
    input.mediaType === "image" && input.mediaUrl
      ? `![${title}](${input.mediaUrl})\n\n${input.body}`
      : input.body;

  const result = await providerFetch(`${MEDIUM_API}/users/${userId}/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify({
      title,
      contentFormat: "markdown",
      content: markdown,
      publishStatus: "public",
    }),
    timeoutMs: BLOG_TIMEOUT_MS,
  });

  if (!result.ok) return { ok: false, message: result.message };
  if (result.status !== 201 && result.status !== 200) {
    return {
      ok: false,
      message: `Medium post failed (${result.status}): ${result.bodyText.slice(0, 200)}`,
    };
  }

  const parsed = parseJsonBody(result.bodyText) as Record<string, unknown> | null;
  const data =
    parsed && typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : null;
  const postId = data && typeof data.id === "string" ? data.id : null;
  if (!postId) return { ok: false, message: "Medium returned no post id." };

  return {
    ok: true,
    postId,
    postUrl: data && typeof data.url === "string" ? data.url : null,
  };
}

export const mediumBehavior: ProviderBehavior = {
  connect: mediumConnect,
  publish: mediumPublish,
};

// ── Lemmy ─────────────────────────────────────────────────────────────────

function normalizeLemmyInstance(rawInstanceUrl: string): string {
  return rawInstanceUrl.trim().replace(/\/+$/, "");
}

async function lemmyConnect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return { ok: false, message: "Lemmy connects with username and password." };
  }
  const instanceUrl = normalizeLemmyInstance(input.values.instanceUrl ?? "");
  const username = (input.values.username ?? "").trim();
  const password = input.values.password ?? "";
  if (!instanceUrl || !username || !password) {
    return {
      ok: false,
      message: "Instance URL, username, and password are all required.",
    };
  }

  const loginResult = await providerFetch(
    `${instanceUrl}/api/v3/user/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username_or_email: username, password }),
      timeoutMs: BLOG_TIMEOUT_MS,
    },
  );
  if (!loginResult.ok) return { ok: false, message: loginResult.message };
  if (loginResult.status !== 200) {
    return {
      ok: false,
      message: `Lemmy login failed (HTTP ${loginResult.status}). Check the instance URL and credentials.`,
    };
  }
  const jwt = readStringField(parseJsonBody(loginResult.bodyText), "jwt");
  if (!jwt) return { ok: false, message: "Lemmy returned no session token." };

  return {
    ok: true,
    // The password is deliberately NOT stored; the session JWT replaces it.
    accessToken: jwt,
    refreshToken: null,
    expiresIn: null,
    identity: {
      accountIdentifier: `${instanceUrl}#${username}`,
      displayName: username,
      username,
      avatarUrl: null,
    },
    config: { instanceUrl },
  };
}

async function lemmyPublish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const instanceUrl =
    typeof input.config.instanceUrl === "string"
      ? normalizeLemmyInstance(input.config.instanceUrl)
      : null;
  if (!instanceUrl) {
    return { ok: false, message: "Stored Lemmy account has no instance URL." };
  }
  const communityId = Number(input.options.communityId);
  if (!Number.isInteger(communityId) || communityId <= 0) {
    return {
      ok: false,
      message: "A community is required (options.communityId).",
    };
  }
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Lemmy posts require a title." };

  const postPayload: Record<string, unknown> = {
    name: title,
    community_id: communityId,
    body: input.body,
  };
  if (input.mediaUrl) postPayload.url = input.mediaUrl;

  const result = await providerFetch(`${instanceUrl}/api/v3/post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify(postPayload),
    timeoutMs: BLOG_TIMEOUT_MS,
  });

  if (!result.ok) return { ok: false, message: result.message };
  if (result.status !== 200) {
    return {
      ok: false,
      message: `Lemmy post failed (${result.status}): ${result.bodyText.slice(0, 200)}`,
    };
  }

  const parsed = parseJsonBody(result.bodyText) as Record<string, unknown> | null;
  const postView =
    parsed && typeof parsed.post_view === "object" && parsed.post_view !== null
      ? (parsed.post_view as Record<string, unknown>)
      : null;
  const post =
    postView && typeof postView.post === "object" && postView.post !== null
      ? (postView.post as Record<string, unknown>)
      : null;
  const postId = post && typeof post.id === "number" ? String(post.id) : null;
  if (!postId) return { ok: false, message: "Lemmy returned no post id." };

  return { ok: true, postId, postUrl: `${instanceUrl}/post/${postId}` };
}

async function lemmyRunTool(
  input: ProviderToolInput,
): Promise<ProviderToolResult> {
  if (input.methodName !== "listCommunities") {
    return { ok: false, message: `Unknown Lemmy tool "${input.methodName}".` };
  }
  const instanceUrl =
    typeof input.config.instanceUrl === "string"
      ? normalizeLemmyInstance(input.config.instanceUrl)
      : null;
  if (!instanceUrl) return { ok: false, message: "Account has no instance URL." };

  const result = await providerFetch(
    `${instanceUrl}/api/v3/community/list?type_=Subscribed&limit=50`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      timeoutMs: BLOG_TIMEOUT_MS,
    },
  );
  if (!result.ok) return { ok: false, message: result.message };
  if (result.status !== 200) {
    return { ok: false, message: `Lemmy community list failed (${result.status}).` };
  }

  const parsed = parseJsonBody(result.bodyText) as Record<string, unknown> | null;
  const communityViews = Array.isArray(parsed?.communities)
    ? parsed.communities
    : [];
  const communities = communityViews
    .map((view) =>
      typeof view === "object" && view !== null
        ? (view as Record<string, unknown>).community
        : null,
    )
    .filter(
      (community): community is Record<string, unknown> =>
        typeof community === "object" && community !== null,
    )
    .map((community) => ({
      id: typeof community.id === "number" ? community.id : null,
      name: typeof community.name === "string" ? community.name : null,
      title: typeof community.title === "string" ? community.title : null,
    }));
  return { ok: true, data: { communities } };
}

export const lemmyBehavior: ProviderBehavior = {
  connect: lemmyConnect,
  publish: lemmyPublish,
  runTool: lemmyRunTool,
};
