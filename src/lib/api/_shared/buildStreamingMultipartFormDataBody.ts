import { randomBytes } from "node:crypto";

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

  const fieldChunks: Uint8Array[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const part =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${key}"\r\n` +
      `\r\n` +
      `${value}\r\n`;
    fieldChunks.push(encoder.encode(part));
  }

  const fileHeader = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\n` +
      `Content-Type: ${fileContentType}\r\n` +
      `\r\n`
  );

  const closing = encoder.encode(`\r\n--${boundary}--\r\n`);

  const preludeBytes =
    fieldChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) +
    fileHeader.byteLength;
  const totalBytes = preludeBytes + fileByteLength + closing.byteLength;

  let fileReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of fieldChunks) {
        controller.enqueue(chunk);
      }
      controller.enqueue(fileHeader);

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
        controller.enqueue(closing);
        controller.close();
        fileReader = null;
        return;
      }

      controller.enqueue(value);
    },

    cancel() {
      if (fileReader) {
        fileReader.cancel().catch((cancelError: unknown) => {
          console.error(
            "[buildStreamingMultipartFormDataBody] Cancelling the file stream failed:",
            cancelError instanceof Error ? cancelError.message : String(cancelError),
          );
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
