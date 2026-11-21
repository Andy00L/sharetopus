import "server-only";

import type {
  CredentialsConnectInput,
  ProviderBehavior,
  ProviderConnectResult,
  ProviderPublishInput,
  ProviderPublishResult,
} from "./types";
import {
  parseJsonObject,
  providerFetch,
  readStringField,
} from "./_shared/providerFetch";
import {
  failHttpAnswer,
  failProviderFetch,
  failUnreadableAnswer,
  refusePublish,
} from "./_shared/publishFailure";
import { REGISTRY_PROVIDER_CATALOG } from "./catalog";

const DEVTO_API_ORIGIN = "https://dev.to/api";
const DEVTO_TIMEOUT_MS = 30_000;

const DEVTO_MAX_BODY_CHARS = REGISTRY_PROVIDER_CATALOG.devto.rules.maxTextLength;

async function connect(
  input: CredentialsConnectInput,
): Promise<ProviderConnectResult> {
  const apiKey = (input.values.apiKey ?? "").trim();
  if (!apiKey) {
    return { ok: false, message: "API key is required." };
  }

  const meResult = await providerFetch(`${DEVTO_API_ORIGIN}/users/me`, {
    method: "GET",
    headers: { "api-key": apiKey, Accept: "application/vnd.forem.api-v1+json" },
    timeoutMs: DEVTO_TIMEOUT_MS,
  });

  if (!meResult.ok) return { ok: false, message: meResult.message };
  if (meResult.status === 401) {
    return { ok: false, message: "Dev.to rejected that API key." };
  }
  if (meResult.status !== 200) {
    return {
      ok: false,
      message: `Dev.to returned HTTP ${meResult.status} while verifying the key.`,
    };
  }

  const user = parseJsonObject(meResult.bodyText);
  const userId = user && typeof user.id === "number" ? String(user.id) : null;

  if (!userId) {
    return { ok: false, message: "Dev.to returned no user id for that key." };
  }

  return {
    ok: true,
    accessToken: apiKey,
    refreshToken: null,
    // forem/forem db/schema.rb api_secrets has no expiry column and
    // Api::V1::ApiController#authenticate_with_api_key checks none: a key
    // lasts until its owner revokes it.
    expiresIn: null,
    identity: {
      accountIdentifier: userId,
      displayName: readStringField(user, "name"),
      username: readStringField(user, "username"),
      avatarUrl: readStringField(user, "profile_image"),
    },
    config: {},
  };
}

async function publish(
  input: ProviderPublishInput,
): Promise<ProviderPublishResult> {
  const articleTitle = input.title.trim();
  if (!articleTitle) {
    return refusePublish("Dev.to articles require a title.");
  }

  const markdownBody = input.body.trim();
  if (markdownBody.length > DEVTO_MAX_BODY_CHARS) {
    return refusePublish(
      `Dev.to articles are limited to ${DEVTO_MAX_BODY_CHARS} characters; this one has ${markdownBody.length}.`,
    );
  }

  // published:true publishes immediately.
  const article: Record<string, unknown> = {
    title: articleTitle,
    body_markdown: markdownBody,
    published: true,
  };

  // forem/forem app/controllers/concerns/api/articles_controller.rb
  // article_params permits `main_image` and `{ tags: [] }`: a tags string is
  // dropped, so tags go out as an array.
  const tags = normalizeTags(input.options.tags ?? []);
  if (tags.length > 0) article.tags = tags;
  if (input.postType === "image" && input.mediaUrl) article.main_image = input.mediaUrl;

  const canonicalUrl = input.options.canonicalUrl?.trim();
  if (canonicalUrl) article.canonical_url = canonicalUrl;

  const createResult = await providerFetch(`${DEVTO_API_ORIGIN}/articles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": input.accessToken,
      Accept: "application/vnd.forem.api-v1+json",
    },
    body: JSON.stringify({ article }),
    timeoutMs: DEVTO_TIMEOUT_MS,
  });

  if (!createResult.ok) {
    return failProviderFetch({
      platform: "devto",
      stage: "publish",
      fetchFailure: createResult,
    });
  }
  if (createResult.status !== 201 && createResult.status !== 200) {
    return failHttpAnswer({
      platform: "devto",
      stage: "publish",
      action: "Dev.to article create",
      httpStatus: createResult.status,
      bodyText: createResult.bodyText,
    });
  }

  const created = parseJsonObject(createResult.bodyText);
  const articleId =
    created && typeof created.id === "number" ? String(created.id) : null;

  if (!articleId) {
    return failUnreadableAnswer({
      message: "Dev.to returned no article id.",
      stage: "publish",
    });
  }

  return {
    ok: true,
    postId: articleId,
    postUrl: readStringField(created, "url"),
  };
}

/**
 * Forem accepts at most four tags and rejects the whole article if a fifth
 * is present, so the list is capped here rather than failing the publish.
 */
function normalizeTags(tags: readonly string[]): string[] {
  return tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0)
    .slice(0, 4);
}

export const devtoBehavior = {
  authKind: "credentials",
  connect,
  publish,
} satisfies ProviderBehavior;
