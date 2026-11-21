import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const cleanedMdxBySlug = new Map<string, string>();

export async function loadMdxRaw(
  slug: string,
): Promise<{ success: true; content: string } | { success: false }> {
  const cachedContent = cleanedMdxBySlug.get(slug);
  if (cachedContent !== undefined) {
    return { success: true, content: cachedContent };
  }
  try {
    const filePath = join(
      process.cwd(),
      "src",
      "content",
      "docs",
      `${slug}.mdx`,
    );
    const rawContent = await readFile(filePath, "utf-8");

    const cleanedContent = rawContent
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .filter((line) => !line.match(/^<[A-Z]/))
      .join("\n")
      .trim();

    cleanedMdxBySlug.set(slug, cleanedContent);
    return { success: true, content: cleanedContent };
  } catch {
    return { success: false };
  }
}
