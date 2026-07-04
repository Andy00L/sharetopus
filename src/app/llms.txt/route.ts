import { NextResponse } from "next/server";
import { buildLlmsTxt } from "@/lib/docs/buildLlmsTxt";

/**
 * GET /llms.txt -- machine-readable site index for AI agents
 * (llmstxt.org format). Points agents at the markdown docs
 * (/docs/*.md) and the OpenAPI spec.
 */
export function GET() {
  return new NextResponse(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
