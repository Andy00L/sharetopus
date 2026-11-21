import { describe, expect, test } from "bun:test";

import { createBodyBytesCollector, readDeclaredBodyBytes } from "./bodyBytesCollector";

describe("readDeclaredBodyBytes", () => {
  test("reads a plain Content-Length", () => {
    expect(readDeclaredBodyBytes(new Headers({ "content-length": "1048576" }))).toBe(1048576);
    expect(
      readDeclaredBodyBytes(new Headers({ "content-length": "42", "content-encoding": "identity" })),
    ).toBe(42);
  });

  test("distrusts a missing, malformed or oversized value", () => {
    expect(readDeclaredBodyBytes(new Headers())).toBeNull();
    expect(readDeclaredBodyBytes(new Headers({ "content-length": "12abc" }))).toBeNull();
    expect(readDeclaredBodyBytes(new Headers({ "content-length": "-5" }))).toBeNull();
    expect(readDeclaredBodyBytes(new Headers({ "content-length": "99999999999999999999" }))).toBeNull();
  });

  test("distrusts the length of an encoded body, which fetch decodes", () => {
    expect(
      readDeclaredBodyBytes(new Headers({ "content-length": "1000", "content-encoding": "gzip" })),
    ).toBeNull();
  });
});

describe("createBodyBytesCollector", () => {
  const firstChunk = Uint8Array.from([1, 2, 3]);
  const secondChunk = Uint8Array.from([4, 5]);

  test("joins the chunks of a body with a declared length", () => {
    const collector = createBodyBytesCollector(5);
    expect(collector.append(firstChunk)).toBe(true);
    expect(collector.append(secondChunk)).toBe(true);
    expect([...collector.collectedBytes()]).toEqual([1, 2, 3, 4, 5]);
  });

  test("refuses a chunk that runs past the declared length", () => {
    const collector = createBodyBytesCollector(4);
    expect(collector.append(firstChunk)).toBe(true);
    expect(collector.append(secondChunk)).toBe(false);
    expect([...collector.collectedBytes()]).toEqual([1, 2, 3]);
  });

  test("returns only the bytes received when the body ends early", () => {
    const collector = createBodyBytesCollector(10);
    collector.append(firstChunk);
    expect([...collector.collectedBytes()]).toEqual([1, 2, 3]);
  });

  test("joins the chunks of a body without a declared length", () => {
    const collector = createBodyBytesCollector(null);
    collector.append(firstChunk);
    collector.append(secondChunk);
    expect([...collector.collectedBytes()]).toEqual([1, 2, 3, 4, 5]);
  });
});
