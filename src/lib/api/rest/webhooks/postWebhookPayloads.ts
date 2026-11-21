import type { PlatformFailureReason } from "@/lib/api/_shared/platformFailure";

import type { WebhookPayload } from "./dispatch";

export type DispatchWebhookFields = {
  dispatch_id: string;
  batch_id: string;
  platform: string;
  social_account_id: string;
};

export type PostFailure = {
  reason: PlatformFailureReason;
  message: string;
  mayHavePublished: boolean;
};

export function pickDispatchWebhookFields(dispatch: DispatchWebhookFields): DispatchWebhookFields {
  return {
    dispatch_id: dispatch.dispatch_id,
    batch_id: dispatch.batch_id,
    platform: dispatch.platform,
    social_account_id: dispatch.social_account_id,
  };
}

export function buildPostFailedFields(failure: PostFailure) {
  return {
    reason: failure.reason,
    error_message: failure.message,
    may_have_published: failure.mayHavePublished,
  };
}

export function buildDispatchFailedPayload(
  dispatch: DispatchWebhookFields,
  failure: PostFailure,
): WebhookPayload {
  return { ...pickDispatchWebhookFields(dispatch), ...buildPostFailedFields(failure) };
}

export function buildConnectionExpiredPayload(account: {
  social_account_id: string;
  platform: string;
}): WebhookPayload {
  return { social_account_id: account.social_account_id, platform: account.platform, reason: "auth_expired" };
}
