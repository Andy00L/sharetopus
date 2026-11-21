import { describe, expect, test } from "bun:test";

import { createObjectUrlStore } from "./use-object-url";

async function readBlobUrl(blobUrl: string): Promise<string | null> {
  try {
    const response = await fetch(blobUrl);
    return await response.text();
  } catch {
    return null;
  }
}

describe("createObjectUrlStore", () => {
  test("serves the blob only while subscribed", async () => {
    const store = createObjectUrlStore(new Blob(["cover frame"]));
    let notificationCount = 0;

    expect(store.getSnapshot()).toBeNull();

    const unsubscribe = store.subscribe(() => {
      notificationCount += 1;
    });
    const subscribedUrl = store.getSnapshot();

    expect(notificationCount).toBe(1);
    expect(subscribedUrl).not.toBeNull();
    expect(await readBlobUrl(subscribedUrl ?? "")).toBe("cover frame");

    unsubscribe();

    expect(store.getSnapshot()).toBeNull();
    expect(await readBlobUrl(subscribedUrl ?? "")).toBeNull();
  });

  test("a resubscribe after cleanup gets a fresh URL and the first stays revoked", async () => {
    const store = createObjectUrlStore(new Blob(["video"]));

    const unsubscribeFirst = store.subscribe(() => {});
    const firstUrl = store.getSnapshot() ?? "";
    unsubscribeFirst();
    store.subscribe(() => {});
    const secondUrl = store.getSnapshot() ?? "";

    expect(secondUrl).not.toBe(firstUrl);
    expect(await readBlobUrl(firstUrl)).toBeNull();
    expect(await readBlobUrl(secondUrl)).toBe("video");
  });
});
