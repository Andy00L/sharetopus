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
 * Dev.to provider. Publishes articles through the Forem API using a
 * personal API key the user generates in their own settings, so nothing
 * needs registering on our side.
 *
 * Long-form, so unlike the social providers the title is a real field
 * rather than a first line, and the body is markdown.
 *
 * sourceRef: developers.forem.com/api/v1 (users/me, articles).
 */

const DEVTO_API_ORIGIN = "https://dev.to/api";
const DEVTO_TIMEOUT_MS = 30_000;

/** Forem accepts long articles; this is a sanity ceiling, not an API limit. */
const DEVTO_MAX_BODY_CHARS = 100_000;

async function connect(
  input: ProviderConnectInput,
): Promise<ProviderConnectResult> {
  if (input.kind !== "credentials") {
    return { ok: false, message: "Dev.to connects with an API key." };
  }

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

  const user = parseJsonBody(meResult.bodyText);
  const userId =
    user && typeof user === "object" && typeof (user as Record<string, unknown>).id === "number"
      ? String((user as Record<string, unknown>).id)
      : null;

  if (!userId) {
    return { ok: false, message: "Dev.to returned no user id for that key." };
  }

  return {
    ok: true,
    accessToken: apiKey,
    refreshToken: null,
    // Forem API keys do not expire.
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
    return { ok: false, message: "Dev.to articles require a title." };
  }

  const markdownBody = buildMarkdownBody(input);

  // published:true publishes immediately. Our scheduler already decided
  // when to run, so a draft would defeat the schedule.
  const article: Record<string, unknown> = {
    title: articleTitle,
    body_markdown: markdownBody,
    published: true,
  };

  const tags = readTagsOption(input.options);
  if (tags.length > 0) article.tags = tags;

  const canonicalUrl = input.options.canonicalUrl;
  if (typeof canonicalUrl === "string" && canonicalUrl.trim().length > 0) {
    article.canonical_url = canonicalUrl.trim();
  }

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

  if (!createResult.ok) return { ok: false, message: createResult.message };

  if (createResult.status === 429) {
    // Forem throttles article creation aggressively; distinct wording so
    // the worker classifies this as retryable.
    return { ok: false, message: "Dev.to rate limit reached (429)." };
  }
  if (createResult.status !== 201 && createResult.status !== 200) {
    return {
      ok: false,
      message: `Dev.to article create failed (${createResult.status}): ${createResult.bodyText.slice(0, 300)}`,
    };
  }

  const created = parseJsonBody(createResult.bodyText);
  const articleId =
    created && typeof created === "object" && typeof (created as Record<string, unknown>).id === "number"
      ? String((created as Record<string, unknown>).id)
      : null;

  if (!articleId) {
    return { ok: false, message: "Dev.to returned no article id." };
  }

  return {
    ok: true,
    postId: articleId,
    postUrl: readStringField(created, "url"),
  };
}

/**
 * Builds the article markdown. A cover image is expressed through the
 * front-matter-free API by embedding it at the top of the body, because
 * the JSON article shape has no cover field for an arbitrary URL.
 */
function buildMarkdownBody(input: ProviderPublishInput): string {
  const body = input.body.trim();
  const withMedia =
    input.mediaType === "image" && input.mediaUrl
      ? `![${input.title.trim() || "cover"}](${input.mediaUrl})\n\n${body}`
      : body;
  return withMedia.slice(0, DEVTO_MAX_BODY_CHARS);
}

/**
 * Reads the tags option. Forem accepts at most four tags and rejects the
 * whole article if a fifth is present, so the list is capped here rather
 * than failing the publish.
 */
function readTagsOption(options: Record<string, unknown>): string[] {
  const rawTags = options.tags;
  if (!Array.isArray(rawTags)) return [];
  return rawTags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0)
    .slice(0, 4);
}

export const devtoBehavior: ProviderBehavior = { connect, publish };
