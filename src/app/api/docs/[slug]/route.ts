import { NextResponse } from "next/server";
import { loadMdxRaw } from "@/lib/api/rest/docs/loadMdxRaw";
import { buildMcpDocMarkdown } from "@/lib/docs/buildMcpDocMarkdown";
import { buildX402DocMarkdown } from "@/lib/docs/buildX402DocMarkdown";

/**
 * GET /api/docs/[slug] -- returns docs as plain markdown for AI agents.
 *
 * Reached via rewrite: /docs/:slug.md -> /api/docs/:slug.
 * Generated slugs (x402, mcp) are rendered from their in-code sources
 * of truth; every other slug maps to an MDX file in src/content/docs
 * with JSX stripped. Path sanitized to prevent directory traversal.
 */

const GENERATED_DOC_BUILDERS: Record<
  string,
  (() => Promise<string>) | undefined
> = {
  x402: buildX402DocMarkdown,
  mcp: buildMcpDocMarkdown,
};

function respondWithMarkdown(content: string): NextResponse {
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

  // Sanitize: only allow lowercase alphanumeric + dashes.
  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "");
  if (!safeSlug || safeSlug !== slug) {
    return new NextResponse("Not found", { status: 404 });
  }

  const buildGeneratedDoc = GENERATED_DOC_BUILDERS[safeSlug];
  if (buildGeneratedDoc) {
    return respondWithMarkdown(await buildGeneratedDoc());
  }

  const result = await loadMdxRaw(safeSlug);
  if (!result.success) {
    return new NextResponse("Not found", { status: 404 });
  }

  return respondWithMarkdown(result.content);
}
