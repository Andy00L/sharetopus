import { NextResponse } from "next/server";
import { loadMdxRaw } from "@/lib/api/rest/docs/loadMdxRaw";
import { buildMcpDocMarkdown } from "@/lib/docs/buildMcpDocMarkdown";
import { buildX402DocMarkdown } from "@/lib/docs/buildX402DocMarkdown";

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
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

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
