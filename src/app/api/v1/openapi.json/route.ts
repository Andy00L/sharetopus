import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/api/rest/openapi/buildDocument";

/**
 * GET /api/v1/openapi.json -- public OpenAPI 3.1 specification.
 *
 * No auth required (matches Stripe/GitHub convention). Cached for
 * 1 hour via Cache-Control and Next.js revalidate.
 */
export const revalidate = 3600;

export async function GET() {
  const document = buildOpenApiDocument();

  return NextResponse.json(document, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Content-Type": "application/json",
    },
  });
}
