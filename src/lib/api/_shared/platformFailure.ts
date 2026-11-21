import { z } from "zod";

import type { Platform } from "@/db/schema";
import { describeNetworkError } from "@/lib/net/describeNetworkError";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";

export type PlatformFailureReason =
  | "auth_expired"
  | "rate_limited"
  | "transient"
  | "policy_rejected"
  | "invalid_input"
  | "unknown";

export type PlatformFailure = {
  reason: PlatformFailureReason;
  mayHavePublished: boolean;
};

export type PlatformPostFailure = {
  success: false;
  error: string;
  details?: Record<string, unknown>;
  failure: PlatformFailure;
};

const PLATFORM_DETAIL_MAX_CHARS = 300;
const RAW_ERROR_MAX_CHARS = 2_000;

// https://developers.facebook.com/docs/graph-api/guides/error-handling and
// https://developers.facebook.com/docs/graph-api/overview/rate-limiting.
// graph.instagram.com answers with the same error envelope.
const GRAPH_RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613, 80001, 80002]);
const GRAPH_TOKEN_CODES = new Set([102, 190]);
const GRAPH_PERMISSION_CODES = new Set([10]);
const GRAPH_POLICY_CODES = new Set([3, 368, 506]);
const GRAPH_TRANSIENT_CODES = new Set([1, 2]);
const GRAPH_PERMISSION_CODE_RANGE = { min: 200, max: 299 };

// https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
const TIKTOK_REASON_BY_CODE = new Map<string, PlatformFailureReason>([
  ["invalid_param", "invalid_input"],
  ["spam_risk_too_many_posts", "rate_limited"],
  ["reached_active_user_cap", "rate_limited"],
  ["rate_limit_exceeded", "rate_limited"],
  ["access_token_invalid", "auth_expired"],
  ["scope_not_authorized", "auth_expired"],
  ["spam_risk_user_banned_from_posting", "policy_rejected"],
  ["unaudited_client_can_only_post_to_private_accounts", "policy_rejected"],
  ["url_ownership_unverified", "policy_rejected"],
  ["privacy_level_option_mismatch", "policy_rejected"],
]);

// https://developers.google.com/youtube/v3/docs/errors
const YOUTUBE_RATE_LIMIT_REASONS = new Set([
  "quotaExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "uploadLimitExceeded",
]);

const GraphErrorBodySchema = z.object({
  error: z.object({
    message: z.string().optional(),
    code: z.number().optional(),
    is_transient: z.boolean().optional(),
  }),
});

const TikTokErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }),
});

const YouTubeErrorBodySchema = z.object({
  error: z.object({
    message: z.string().optional(),
    errors: z.array(z.object({ reason: z.string() })).optional(),
  }),
});

const XProblemBodySchema = z.object({
  detail: z.string().optional(),
  title: z.string().optional(),
});

const MessageBodySchema = z.object({ message: z.string() });

type HttpFailureClassification = {
  reason: PlatformFailureReason;
  platformDetail: string | null;
};

function classifyHttpStatus(httpStatus: number): PlatformFailureReason {
  if (httpStatus === 401) return "auth_expired";
  if (httpStatus === 403) return "policy_rejected";
  if (httpStatus === 408) return "transient";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus >= 500) return "transient";
  if (httpStatus >= 400) return "invalid_input";
  return "unknown";
}

function classifyGraphCode(graphError: {
  code?: number;
  is_transient?: boolean;
}): PlatformFailureReason | null {
  const graphCode = graphError.code;
  if (graphCode !== undefined) {
    if (GRAPH_RATE_LIMIT_CODES.has(graphCode)) return "rate_limited";
    if (GRAPH_TOKEN_CODES.has(graphCode)) return "auth_expired";
    if (
      GRAPH_PERMISSION_CODES.has(graphCode) ||
      (graphCode >= GRAPH_PERMISSION_CODE_RANGE.min &&
        graphCode <= GRAPH_PERMISSION_CODE_RANGE.max)
    ) {
      return "auth_expired";
    }
    if (GRAPH_POLICY_CODES.has(graphCode)) return "policy_rejected";
    if (GRAPH_TRANSIENT_CODES.has(graphCode)) return "transient";
  }
  return graphError.is_transient === true ? "transient" : null;
}

function joinDetailParts(parts: (string | null | undefined)[]): string | null {
  const presentParts = parts.filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return presentParts.length > 0 ? presentParts.join(": ") : null;
}

function classifyPlatformBody(
  platform: Platform,
  responseBody: Record<string, unknown> | null,
): HttpFailureClassification | null {
  switch (platform) {
    case "facebook":
    case "instagram": {
      const parsedBody = GraphErrorBodySchema.safeParse(responseBody);
      if (!parsedBody.success) return null;
      const graphError = parsedBody.data.error;
      const graphReason = classifyGraphCode(graphError);
      return {
        reason: graphReason ?? "unknown",
        platformDetail: joinDetailParts([
          graphError.code !== undefined ? `code ${graphError.code}` : null,
          graphError.message,
        ]),
      };
    }
    case "tiktok": {
      const parsedBody = TikTokErrorBodySchema.safeParse(responseBody);
      if (!parsedBody.success) return null;
      const tikTokError = parsedBody.data.error;
      return {
        reason: TIKTOK_REASON_BY_CODE.get(tikTokError.code) ?? "unknown",
        platformDetail: joinDetailParts([tikTokError.code, tikTokError.message]),
      };
    }
    case "youtube": {
      const parsedBody = YouTubeErrorBodySchema.safeParse(responseBody);
      if (!parsedBody.success) return null;
      const errorReasons = (parsedBody.data.error.errors ?? []).map(
        (errorItem) => errorItem.reason,
      );
      const isRateLimited = errorReasons.some((errorReason) =>
        YOUTUBE_RATE_LIMIT_REASONS.has(errorReason),
      );
      return {
        reason: isRateLimited ? "rate_limited" : "unknown",
        platformDetail: joinDetailParts([
          errorReasons.join(", "),
          parsedBody.data.error.message,
        ]),
      };
    }
    case "x": {
      const parsedBody = XProblemBodySchema.safeParse(responseBody);
      if (!parsedBody.success) return null;
      return {
        reason: "unknown",
        platformDetail: parsedBody.data.detail ?? parsedBody.data.title ?? null,
      };
    }
    default: {
      const parsedBody = MessageBodySchema.safeParse(responseBody);
      if (!parsedBody.success) return null;
      return { reason: "unknown", platformDetail: parsedBody.data.message };
    }
  }
}

/**
 * Reads the reason from the platform's own error code first, then from the
 * HTTP status. Exported for tests.
 */
export function classifyPlatformHttpFailure(input: {
  platform: Platform;
  httpStatus: number;
  responseText: string;
}): HttpFailureClassification {
  const bodyClassification = classifyPlatformBody(
    input.platform,
    parseJsonObject(input.responseText),
  );
  const statusReason = classifyHttpStatus(input.httpStatus);
  if (!bodyClassification) {
    return { reason: statusReason, platformDetail: null };
  }
  return {
    reason:
      bodyClassification.reason === "unknown"
        ? statusReason
        : bodyClassification.reason,
    platformDetail: bodyClassification.platformDetail,
  };
}

/**
 * A non-2xx answer. Only a 5xx answer to the request that publishes can
 * hide a published post; any other refusal published nothing.
 */
export function buildHttpFailure(input: {
  platform: Platform;
  action: string;
  httpStatus: number;
  responseText: string;
  isPublishRequest: boolean;
}): PlatformPostFailure {
  const classification = classifyPlatformHttpFailure(input);
  const detailSuffix = classification.platformDetail
    ? `: ${classification.platformDetail.slice(0, PLATFORM_DETAIL_MAX_CHARS)}`
    : "";
  return {
    success: false,
    error: `${input.action} failed (${input.httpStatus})${detailSuffix}`,
    details: parseJsonObject(input.responseText) ?? {
      rawError: input.responseText.slice(0, RAW_ERROR_MAX_CHARS),
    },
    failure: {
      reason: classification.reason,
      mayHavePublished: input.isPublishRequest && input.httpStatus >= 500,
    },
  };
}

/** The request never got an answer (DNS, reset, timeout). */
export function buildNetworkFailure(input: {
  action: string;
  requestError: unknown;
  isPublishRequest: boolean;
}): PlatformPostFailure {
  return {
    success: false,
    error: `${input.action} request failed: ${describeNetworkError(input.requestError)}`,
    failure: { reason: "transient", mayHavePublished: input.isPublishRequest },
  };
}

/** A 2xx answer this code cannot read, so whether it published is unknown. */
export function buildUnreadableAnswerFailure(input: {
  action: string;
  isPublishRequest: boolean;
}): PlatformPostFailure {
  return {
    success: false,
    error: `${input.action} returned an unexpected response`,
    failure: { reason: "unknown", mayHavePublished: input.isPublishRequest },
  };
}

/** Our own check refused the post before any platform request. */
export function buildInputFailure(error: string): PlatformPostFailure {
  return {
    success: false,
    error,
    failure: { reason: "invalid_input", mayHavePublished: false },
  };
}
