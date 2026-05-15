import { NextResponse } from "next/server";
import { loadMdxRaw } from "@/lib/api/rest/docs/loadMdxRaw";

/**
 * GET /api/docs/[slug] -- returns raw MDX source as plain markdown.
 *
 * Reached via rewrite: /docs/:slug.md -> /api/docs/:slug.
 * Strips JSX components for AI-agent-friendly output.
 * Path sanitized to prevent directory traversal.
 */
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

  const result = await loadMdxRaw(safeSlug);
  if (!result.success) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(result.content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
