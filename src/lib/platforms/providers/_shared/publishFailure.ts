import type { Platform } from "@/db/schema";
import {
  classifyPlatformHttpFailure,
  type PlatformFailure,
  type PlatformFailureReason,
} from "@/lib/api/_shared/platformFailure";

import type { ProviderPublishFailure } from "../types";
import type { ProviderFetchFailure } from "./providerFetch";

export type PublishRequestStage = "prepare" | "publish";

const ERROR_BODY_MAX_CHARS = 300;

export function refusePublish(message: string): ProviderPublishFailure {
  return failPublish({ message, reason: "invalid_input", mayHavePublished: false });
}

export function failPublish(input: {
  message: string;
  reason: PlatformFailureReason;
  mayHavePublished: boolean;
}): ProviderPublishFailure {
  return {
    ok: false,
    message: input.message,
    failure: { reason: input.reason, mayHavePublished: input.mayHavePublished },
  };
}

export function classifyHttpAnswer(input: {
  platform: Platform;
  stage: PublishRequestStage;
  httpStatus: number;
  bodyText: string;
}): PlatformFailure {
  const isPublishStage = input.stage === "publish";
  if (input.httpStatus >= 200 && input.httpStatus < 300) {
    return { reason: "unknown", mayHavePublished: isPublishStage };
  }
  const { reason } = classifyPlatformHttpFailure({
    platform: input.platform,
    httpStatus: input.httpStatus,
    responseText: input.bodyText,
  });
  return { reason, mayHavePublished: isPublishStage && input.httpStatus >= 500 };
}

export function failProviderFetch(input: {
  platform: Platform;
  stage: PublishRequestStage;
  fetchFailure: ProviderFetchFailure;
}): ProviderPublishFailure {
  const { fetchFailure } = input;
  switch (fetchFailure.kind) {
    case "not_sent":
      return failPublish({
        message: fetchFailure.message,
        reason: fetchFailure.reason,
        mayHavePublished: false,
      });
    case "no_answer":
      return failPublish({
        message: fetchFailure.message,
        reason: "transient",
        mayHavePublished: input.stage === "publish",
      });
    case "redirected":
    case "unreadable_body":
      return {
        ok: false,
        message: fetchFailure.message,
        failure: classifyHttpAnswer({
          platform: input.platform,
          stage: input.stage,
          httpStatus: fetchFailure.status,
          bodyText: "",
        }),
      };
    default: {
      const unhandledFailure: never = fetchFailure;
      return failPublish({
        message: `Unhandled provider fetch failure: ${String(unhandledFailure)}`,
        reason: "unknown",
        mayHavePublished: input.stage === "publish",
      });
    }
  }
}

export function failHttpAnswer(input: {
  platform: Platform;
  stage: PublishRequestStage;
  action: string;
  httpStatus: number;
  bodyText: string;
}): ProviderPublishFailure {
  const bodyExcerpt = input.bodyText.slice(0, ERROR_BODY_MAX_CHARS);
  return {
    ok: false,
    message: bodyExcerpt
      ? `${input.action} failed (${input.httpStatus}): ${bodyExcerpt}`
      : `${input.action} failed (${input.httpStatus}).`,
    failure: classifyHttpAnswer(input),
  };
}

export function failUnreadableAnswer(input: {
  message: string;
  stage: PublishRequestStage;
}): ProviderPublishFailure {
  return failPublish({
    message: input.message,
    reason: "unknown",
    mayHavePublished: input.stage === "publish",
  });
}
