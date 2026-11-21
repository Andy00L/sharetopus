import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const cleanedMdxBySlug = new Map<string, string>();

/**
 * Reads an MDX file from src/content/docs/ and returns the raw source.
 * Strips import statements and JSX components to keep the output
 * AI-agent-friendly plain markdown.
 *
 * Path is sanitized by the caller (slug must be alphanumeric + dashes).
 * The files ship with the deployment, so each one is read once per
 * instance; a slug with no file is never stored.
 */
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

    // Strip MDX-specific lines (imports, JSX components) for plain markdown.
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
