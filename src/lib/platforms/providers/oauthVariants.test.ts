import { describe, expect, mock, test } from "bun:test";
import { Blob } from "node:buffer";

import type { ProviderFetchResult } from "./_shared/providerFetch";
import type { ProviderPublishInput } from "./types";

mock.module("server-only", () => ({}));

mock.module("./_shared/fetchStoredMedia", () => ({
  STORED_MEDIA_MAX_BYTES: 1024,
  fetchStoredMedia: async () => ({ ok: true, media: new Blob(["png bytes"]) }),
}));

type LinkedInShareCall = {
  authorUrn: string;
  text: string;
  postType: string;
  mediaType?: string;
  buffer?: Buffer;
};
const linkedInShareCalls: LinkedInShareCall[] = [];
let linkedInShareAnswer: unknown = { success: true, postId: "urn:li:share:1", data: {}, message: "" };
mock.module("@/lib/api/linkedin/post/postToLinkedIn", () => ({
  UNKNOWN_LINKEDIN_POST_ID: "unknown-post-id",
  postToLinkedIn: async (shareCall: LinkedInShareCall) => {
    linkedInShareCalls.push(shareCall);
    return linkedInShareAnswer;
  },
}));

const realProviderFetch = await import("./_shared/providerFetch");
let nextAnswer: ProviderFetchResult = { ok: true, status: 202, bodyText: "", headers: {} };
mock.module("./_shared/providerFetch", () => ({
  ...realProviderFetch,
  providerFetch: async () => nextAnswer,
}));

const { dribbbleBehavior, linkedinPageBehavior } = await import("./oauthVariants");

const SHOT_POST: ProviderPublishInput = {
  accessToken: "token",
  config: {},
  accountIdentifier: "77",
  title: "Logo study",
  body: "",
  postType: "image",
  mediaUrl: "https://storage.test/shot.png",
  fileName: "shot.png",
  mediaMimeType: "image/png",
  options: {},
  idempotencyKey: "post-1",
};

describe("Dribbble shot create", () => {
  test("the shot id comes from the 202 Location header", async () => {
    nextAnswer = {
      ok: true,
      status: 202,
      bodyText: "",
      headers: { location: "https://api.dribbble.com/v2/shots/471756" },
    };
    expect(await dribbbleBehavior.publish(SHOT_POST)).toEqual({
      ok: true,
      postId: "471756",
      postUrl: null,
    });
  });

  test("a 202 without a Location is an unknown outcome, not a fabricated id", async () => {
    nextAnswer = { ok: true, status: 202, bodyText: "", headers: {} };
    const published = await dribbbleBehavior.publish(SHOT_POST);
    expect(published.ok ? null : published.failure).toEqual({
      reason: "unknown",
      mayHavePublished: true,
    });
  });
});

describe("LinkedIn Page publish", () => {
  const PAGE_POST: ProviderPublishInput = {
    ...SHOT_POST,
    config: { organizationId: "5590506" },
    accountIdentifier: "org-5590506",
    body: "Hiring",
  };

  test("an image is uploaded as bytes and shared as the organization", async () => {
    linkedInShareCalls.length = 0;
    linkedInShareAnswer = { success: true, postId: "urn:li:share:7", data: {}, message: "" };
    expect(await linkedinPageBehavior.publish(PAGE_POST)).toEqual({
      ok: true,
      postId: "urn:li:share:7",
      postUrl: null,
    });
    const shareCall = linkedInShareCalls[0];
    expect(shareCall?.authorUrn).toBe("urn:li:organization:5590506");
    expect(shareCall?.postType).toBe("image");
    expect(shareCall?.mediaType).toBe("image/png");
    expect(shareCall?.buffer?.toString("utf8")).toBe("png bytes");
  });

  test("a text post fetches no media", async () => {
    linkedInShareCalls.length = 0;
    await linkedinPageBehavior.publish({ ...PAGE_POST, postType: "text", mediaUrl: null });
    expect(linkedInShareCalls[0]?.postType).toBe("text");
    expect(linkedInShareCalls[0]?.buffer).toBeUndefined();
  });

  test("a share LinkedIn created without returning its id is a published post", async () => {
    linkedInShareAnswer = { success: true, postId: undefined, data: {}, message: "" };
    expect(await linkedinPageBehavior.publish(PAGE_POST)).toEqual({
      ok: true,
      postId: "unknown-post-id",
      postUrl: null,
    });
  });

  test("the share failure keeps its typed reason", async () => {
    linkedInShareAnswer = {
      success: false,
      error: "LinkedIn share creation failed (503)",
      failure: { reason: "transient", mayHavePublished: true },
    };
    expect(await linkedinPageBehavior.publish(PAGE_POST)).toEqual({
      ok: false,
      message: "LinkedIn share creation failed (503)",
      failure: { reason: "transient", mayHavePublished: true },
    });
  });
});
