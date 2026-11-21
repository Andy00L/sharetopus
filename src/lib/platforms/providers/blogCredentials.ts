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
import { isJsonObject, toJsonObject, type JsonObject } from "@/lib/utils/jsonObject";

import {
  parseJsonBody,
  parseJsonObject,
  providerFetch,
  readStringField,
  type ProviderFetchFailure,
} from "./_shared/providerFetch";
import {
  classifyHttpAnswer,
  failHttpAnswer,
  failProviderFetch,
  failPublish,
  failUnreadableAnswer,
  refusePublish,
} from "./_shared/publishFailure";

const BLOG_TIMEOUT_MS = 30_000;

const HASHNODE_GQL = "https://gql.hashnode.com";

type HashnodeGqlFailure =
  | { ok: false; kind: "fetch"; message: string; fetchFailure: ProviderFetchFailure }
  | { ok: false; kind: "graphql_errors"; message: string }
  | { ok: false; kind: "unreadable"; message: string; httpStatus: number; bodyText: string };

async function hashnodeGql(
  apiToken: string,
  query: string,
  variables: JsonObject,
): Promise<{ ok: true; data: JsonObject } | HashnodeGqlFailure> {
  const result = await providerFetch(HASHNODE_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiToken,
    },
    body: JSON.stringify({ query, variables }),
    timeoutMs: BLOG_TIMEOUT_MS,
  });
  if (!result.ok) {
    return { ok: false, kind: "fetch", message: result.message, fetchFailure: result };
  }
  const parsed = parseJsonObject(result.bodyText);
  const gqlErrors: unknown[] = Array.isArray(parsed?.errors) ? parsed.errors : [];
  if (gqlErrors.length > 0) {
    const firstError = toJsonObject(gqlErrors[0])?.message ?? "GraphQL error";
    return {
      ok: false,
      kind: "graphql_errors",
      message: `Hashnode: ${String(firstError).slice(0, 200)}`,
    };
  }
  const data = toJsonObject(parsed?.data);
  if (!data) {
    return {
      ok: false,
      kind: "unreadable",
      message: `Hashnode returned no data (HTTP ${result.status}).`,
      httpStatus: result.status,
      bodyText: result.bodyText,
    };
  }
  return { ok: true, data };
}

function failHashnodePublish(gqlFailure: HashnodeGqlFailure): ProviderPublishFailure {
  switch (gqlFailure.kind) {
    case "fetch":
      return failProviderFetch({
        platform: "hashnode",
        stage: "publish",
        fetchFailure: gqlFailure.fetchFailure,
      });
    case "graphql_errors":
      return failPublish({
        message: gqlFailure.message,
        reason: "unknown",
        mayHavePublished: false,
      });
    case "unreadable":
      return {
        ok: false,
        message: gqlFailure.message,
        failure: classifyHttpAnswer({
          platform: "hashnode",
          stage: "publish",
          httpStatus: gqlFailure.httpStatus,
          bodyText: gqlFailure.bodyText,
        }),
      };
    default: {
      const unhandledFailure: never = gqlFailure;
      return failUnreadableAnswer({
        message: `Unhandled Hashnode failure: ${String(unhandledFailure)}`,
        stage: "publish",
      });
    }
  }
}

async function hashnodeConnect(
  input: CredentialsConnectInput,
): Promise<ProviderConnectResult> {
  const apiToken = (input.values.apiToken ?? "").trim();
  if (!apiToken) return { ok: false, message: "API token is required." };

  const me = await hashnodeGql(
    apiToken,
    `query Me { me { id username name profilePicture publications(first: 1) { edges { node { id title } } } } }`,
    {},
  );
  if (!me.ok) return { ok: false, message: me.message };

  const meNode = toJsonObject(me.data.me);
  const userId = meNode && typeof meNode.id === "string" ? meNode.id : null;
  if (!userId) return { ok: false, message: "Hashnode token is not valid." };

  const publications = toJsonObject(meNode?.publications);
  const edges: unknown[] = Array.isArray(publications?.edges) ? publications.edges : [];
  const firstNode = toJsonObject(toJsonObject(edges[0])?.node);
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
  const storedPublicationId =
    typeof input.config.publicationId === "string" ? input.config.publicationId : null;
  const publicationId = input.options.publicationId || storedPublicationId;
  if (!publicationId) {
    return refusePublish("Hashnode account has no publication.");
  }
  const title = input.title.trim();
  if (!title) return refusePublish("Hashnode posts require a title.");

  const markdown =
    input.postType === "image" && input.mediaUrl
      ? `![${title}](${input.mediaUrl})\n\n${input.body}`
      : input.body;

  const published = await hashnodeGql(
    input.accessToken,
    `mutation Publish($input: PublishPostInput!) {
       publishPost(input: $input) { post { id url } }
     }`,
    { input: { title, contentMarkdown: markdown, publicationId } },
  );
  if (!published.ok) return failHashnodePublish(published);

  const post = toJsonObject(toJsonObject(published.data.publishPost)?.post);
  const postId = post && typeof post.id === "string" ? post.id : null;
  if (!postId) {
    return failUnreadableAnswer({ message: "Hashnode returned no post id.", stage: "publish" });
  }

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

  const publications = toJsonObject(toJsonObject(me.data.me)?.publications);
  const edges: unknown[] = Array.isArray(publications?.edges) ? publications.edges : [];
  const list = edges
    .map((edge) => toJsonObject(edge)?.node)
    .filter(isJsonObject)
    .map((node) => ({
      id: typeof node.id === "string" ? node.id : null,
      title: typeof node.title === "string" ? node.title : null,
      url: typeof node.url === "string" ? node.url : null,
    }));
  return { ok: true, data: { publications: list } };
}

export const hashnodeBehavior = {
  authKind: "credentials",
  connect: hashnodeConnect,
  publish: hashnodePublish,
  runTool: hashnodeRunTool,
} satisfies ProviderBehavior;

const MEDIUM_API = "https://api.medium.com/v1";

async function mediumConnect(
  input: CredentialsConnectInput,
): Promise<ProviderConnectResult> {
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

  const data = toJsonObject(parseJsonObject(meResult.bodyText)?.data);
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
  if (!title) return refusePublish("Medium posts require a title.");

  const markdown =
    input.postType === "image" && input.mediaUrl
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

  if (!result.ok) {
    return failProviderFetch({ platform: "medium", stage: "publish", fetchFailure: result });
  }
  if (result.status !== 201 && result.status !== 200) {
    return failHttpAnswer({
      platform: "medium",
      stage: "publish",
      action: "Medium post",
      httpStatus: result.status,
      bodyText: result.bodyText,
    });
  }

  const data = toJsonObject(parseJsonObject(result.bodyText)?.data);
  const postId = data && typeof data.id === "string" ? data.id : null;
  if (!postId) {
    return failUnreadableAnswer({ message: "Medium returned no post id.", stage: "publish" });
  }

  return {
    ok: true,
    postId,
    postUrl: data && typeof data.url === "string" ? data.url : null,
  };
}

export const mediumBehavior = {
  authKind: "credentials",
  connect: mediumConnect,
  publish: mediumPublish,
} satisfies ProviderBehavior;

function normalizeLemmyInstance(rawInstanceUrl: string): string {
  return rawInstanceUrl.trim().replace(/\/+$/, "");
}

async function lemmyConnect(
  input: CredentialsConnectInput,
): Promise<ProviderConnectResult> {
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
    return refusePublish("Stored Lemmy account has no instance URL.");
  }
  const communityId = input.options.communityId;
  if (communityId === undefined || !Number.isInteger(communityId) || communityId <= 0) {
    return refusePublish("A community is required (options.communityId).");
  }
  const title = input.title.trim();
  if (!title) return refusePublish("Lemmy posts require a title.");

  const postPayload: JsonObject = {
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

  if (!result.ok) {
    return failProviderFetch({ platform: "lemmy", stage: "publish", fetchFailure: result });
  }
  if (result.status !== 200) {
    return failHttpAnswer({
      platform: "lemmy",
      stage: "publish",
      action: "Lemmy post",
      httpStatus: result.status,
      bodyText: result.bodyText,
    });
  }

  const post = toJsonObject(toJsonObject(parseJsonObject(result.bodyText)?.post_view)?.post);
  const postId = post && typeof post.id === "number" ? String(post.id) : null;
  if (!postId) {
    return failUnreadableAnswer({ message: "Lemmy returned no post id.", stage: "publish" });
  }

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

  const parsed = parseJsonObject(result.bodyText);
  const communityViews: unknown[] = Array.isArray(parsed?.communities)
    ? parsed.communities
    : [];
  const communities = communityViews
    .map((view) => toJsonObject(view)?.community)
    .filter(isJsonObject)
    .map((community) => ({
      id: typeof community.id === "number" ? community.id : null,
      name: typeof community.name === "string" ? community.name : null,
      title: typeof community.title === "string" ? community.title : null,
    }));
  return { ok: true, data: { communities } };
}

export const lemmyBehavior = {
  authKind: "credentials",
  connect: lemmyConnect,
  publish: lemmyPublish,
  runTool: lemmyRunTool,
} satisfies ProviderBehavior;
