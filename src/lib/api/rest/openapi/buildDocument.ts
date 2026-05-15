import "server-only";

import { restPaths } from "./paths";

/**
 * Builds the full OpenAPI 3.1 document for the Sharetopus REST API.
 *
 * Single source of truth: every endpoint here references the SAME Zod
 * schemas used for runtime validation. The paths object is the
 * canonical registry of all v1 endpoints.
 *
 * Public endpoint, cached for 1 hour. No auth required.
 */
export function buildOpenApiDocument() {
  return {
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
  };
}
