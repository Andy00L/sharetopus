import { ApiReference } from "@scalar/nextjs-api-reference";

/**
 * GET /docs/api -- Scalar interactive API reference viewer.
 *
 * Uses the route handler pattern required by @scalar/nextjs-api-reference.
 * Points at the public OpenAPI 3.1 spec endpoint.
 */
export const GET = ApiReference({
  spec: { url: "/api/v1/openapi.json" },
});
