import "server-only";

import { createDocument } from "zod-openapi";

import { restPaths } from "./paths";

/**
 * Builds the full OpenAPI 3.1 document for the Sharetopus REST API.
 *
 * The paths object is the canonical registry of all v1 endpoints.
 * createDocument (zod-openapi) renders its Zod schemas to JSON Schema:
 * request bodies and query parameters from the schemas the routes
 * validate with, and every schema carrying .meta({ id }) becomes a
 * component under components.schemas. Serving the paths without it sent
 * Zod's internal objects instead of schemas.
 *
 * Public endpoint, cached for 1 hour. No auth required.
 */
export function buildOpenApiDocument() {
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "Sharetopus REST API",
      version: "1.0.0",
      description:
        "Programmatic access to scheduling, connections, media, analytics, and webhooks. Authenticate with a Bearer token (stp_rest_...).",
    },
    servers: [
      { url: "https://sharetopus.com", description: "Production" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "stp_rest_...",
          description:
            "Create an API key at /integrations. Prefix: stp_rest_",
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: restPaths,
  });
}
