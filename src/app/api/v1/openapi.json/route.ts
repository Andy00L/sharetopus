import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/api/rest/openapi/buildDocument";

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
