const DECIMAL_DIGITS = /^\d+$/;

type HeaderReader = { get(headerName: string): string | null };

// fetch decodes Content-Encoding, while Content-Length counts the encoded bytes (RFC 9110 section 8.6).
export function readDeclaredBodyBytes(responseHeaders: HeaderReader): number | null {
  const contentEncoding = responseHeaders.get("content-encoding")?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") return null;

  const contentLength = responseHeaders.get("content-length")?.trim();
  if (!contentLength || !DECIMAL_DIGITS.test(contentLength)) return null;

  const declaredBytes = Number(contentLength);
  return Number.isSafeInteger(declaredBytes) ? declaredBytes : null;
}

type BodyBytesCollector = {
  append(chunk: Uint8Array): boolean;
  collectedBytes(): Buffer;
};

export function createBodyBytesCollector(declaredBytes: number | null): BodyBytesCollector {
  if (declaredBytes === null) {
    const chunks: Uint8Array[] = [];
    let chunkBytes = 0;
    return {
      append(chunk) {
        chunks.push(chunk);
        chunkBytes += chunk.byteLength;
        return true;
      },
      collectedBytes: () => Buffer.concat(chunks, chunkBytes),
    };
  }

  const preallocatedBody = Buffer.allocUnsafe(declaredBytes);
  let writtenBytes = 0;
  return {
    append(chunk) {
      if (writtenBytes + chunk.byteLength > declaredBytes) return false;
      preallocatedBody.set(chunk, writtenBytes);
      writtenBytes += chunk.byteLength;
      return true;
    },
    collectedBytes: () => preallocatedBody.subarray(0, writtenBytes),
  };
}
