import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));

const { postToLinkedIn } = await import("./postToLinkedIn");

type SentRequest = { url: string; method: string; body: string };

const originalFetch = globalThis.fetch;

function stubLinkedInShare(shareAnswer: Response): SentRequest[] {
  const sentRequests: SentRequest[] = [];
  const answerShare = async (requestInput: string | URL | Request, requestInit?: RequestInit) => {
    sentRequests.push({
      url: String(requestInput),
      method: requestInit?.method ?? "GET",
      body: typeof requestInit?.body === "string" ? requestInit.body : "",
    });
    return shareAnswer;
  };
  globalThis.fetch = Object.assign(answerShare, { preconnect: originalFetch.preconnect });
  return sentRequests;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("postToLinkedIn share answer", () => {
  test("a 201 that names the post in x-restli-id returns that id, with the organization as author", async () => {
    const sentRequests = stubLinkedInShare(
      new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:42" } }),
    );
    const shareResult = await postToLinkedIn({
      accessToken: "token",
      authorUrn: "urn:li:organization:5590506",
      text: "Hiring",
      postType: "text",
    });
    expect(shareResult.success && shareResult.postId).toBe("urn:li:share:42");
    expect(sentRequests).toHaveLength(1);
    expect(sentRequests[0].url).toBe("https://api.linkedin.com/v2/ugcPosts");
    expect(JSON.parse(sentRequests[0].body).author).toBe("urn:li:organization:5590506");
  });

  test("a 201 without any post id is still a published post, with no invented id", async () => {
    stubLinkedInShare(new Response("", { status: 201 }));
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const shareResult = await postToLinkedIn({
      accessToken: "token",
      authorUrn: "urn:li:person:abc",
      text: "Hello",
      postType: "text",
    });
    expect(shareResult.success).toBe(true);
    expect(shareResult.success ? shareResult.postId : "failed").toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
