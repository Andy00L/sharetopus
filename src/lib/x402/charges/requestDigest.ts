import { createHash } from "node:crypto";

type DigestableValue = string | number | boolean | null | DigestableValue[] | DigestableBody;

export type DigestableBody = { readonly [key: string]: DigestableValue | undefined };

export function digestRequestBody(requestBody: DigestableBody): string {
  return createHash("sha256").update(serializeCanonically(requestBody), "utf8").digest("hex");
}

function serializeCanonically(value: DigestableValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serializeCanonically).join(",")}]`;
  const serializedEntries = Object.keys(value)
    .sort()
    .flatMap((key) => {
      const entryValue = value[key];
      return entryValue === undefined ? [] : [`${JSON.stringify(key)}:${serializeCanonically(entryValue)}`];
    });
  return `{${serializedEntries.join(",")}}`;
}
