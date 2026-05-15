import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Reads an MDX file from src/content/docs/ and returns the raw source.
 * Strips import statements and JSX components to keep the output
 * AI-agent-friendly plain markdown.
 *
 * Path is sanitized by the caller (slug must be alphanumeric + dashes).
 */
export async function loadMdxRaw(
  slug: string,
): Promise<{ success: true; content: string } | { success: false }> {
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

    return { success: true, content: cleanedContent };
  } catch {
    return { success: false };
  }
}
