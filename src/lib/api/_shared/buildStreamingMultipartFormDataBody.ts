import { randomBytes } from "node:crypto";

/**
 * Build a streaming multipart/form-data body suitable for HTTP POST.
 *
 * Streams the file source through chunk-by-chunk without ever holding
 * the full file in memory. Computes the Content-Length precisely so
 * upstream services that require it (notably AWS S3 POST endpoints
 * with content-length-range policies) accept the request.
 *
 * Returns the body as a ReadableStream<Uint8Array> and the matching
 * headers (Content-Type with boundary, Content-Length in bytes). The
 * caller is responsible for setting `duplex: "half"` on the fetch
 * options because the body is a ReadableStream.
 */
export function buildStreamingMultipartFormDataBody(input: {
  fields: Record<string, string>;
  fileFieldName: string;
  fileName: string;
  fileContentType: string;
  fileByteLength: number;
  fileStream: ReadableStream<Uint8Array>;
}): {
  body: ReadableStream<Uint8Array>;
  headers: { "Content-Type": string; "Content-Length": string };
} {
  const {
    fields,
    fileFieldName,
    fileName,
    fileContentType,
    fileByteLength,
    fileStream,
  } = input;

  const boundary = randomBytes(16).toString("hex");
  const encoder = new TextEncoder();

  // Pre-encode every text part so we can compute total byte length.

  // Field parts: --boundary\r\nContent-Disposition: form-data; name="KEY"\r\n\r\nVALUE\r\n
  const fieldChunks: Uint8Array[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const part =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${key}"\r\n` +
      `\r\n` +
      `${value}\r\n`;
    fieldChunks.push(encoder.encode(part));
  }

  // File header: --boundary\r\nContent-Disposition: form-data; name="FIELD"; filename="NAME"\r\nContent-Type: TYPE\r\n\r\n
  const fileHeader = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\n` +
      `Content-Type: ${fileContentType}\r\n` +
      `\r\n`
  );

  // Closing boundary: \r\n--boundary--\r\n
  const closing = encoder.encode(`\r\n--${boundary}--\r\n`);

  // Precise Content-Length: sum of all pre-encoded parts + file bytes + closing
  const preludeBytes =
    fieldChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) +
    fileHeader.byteLength;
  const totalBytes = preludeBytes + fileByteLength + closing.byteLength;

  let fileReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Enqueue all field parts and the file header immediately.
      for (const chunk of fieldChunks) {
        controller.enqueue(chunk);
      }
      controller.enqueue(fileHeader);

      // Acquire reader for the file stream.
      fileReader = fileStream.getReader();
    },

    async pull(controller) {
      if (!fileReader) {
        controller.enqueue(closing);
        controller.close();
        return;
      }

      const { done, value } = await fileReader.read();

      if (done) {
        // File stream exhausted. Emit closing boundary and close.
        controller.enqueue(closing);
        controller.close();
        fileReader = null;
        return;
      }

      controller.enqueue(value);
    },

    cancel() {
      // Upstream cancelled the request. Clean up the file reader.
      if (fileReader) {
        fileReader.cancel().catch(() => {
          // Swallow cancel errors; the stream is being torn down.
        });
        fileReader = null;
      }
    },
  });

  return {
    body,
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(totalBytes),
    },
  };
}
