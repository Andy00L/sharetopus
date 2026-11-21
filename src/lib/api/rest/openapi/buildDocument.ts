import "server-only";

import { createDocument } from "zod-openapi";

import { restPaths } from "./paths";

export function buildOpenApiDocument(): OpenApiDocument {
  cachedOpenApiDocument ??= renderOpenApiDocument();
  return cachedOpenApiDocument;
}

type OpenApiDocument = ReturnType<typeof createDocument>;

let cachedOpenApiDocument: OpenApiDocument | undefined;

function renderOpenApiDocument(): OpenApiDocument {
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
