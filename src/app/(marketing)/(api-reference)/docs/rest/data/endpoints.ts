import type { DocsSection } from "@/lib/docs/apiReferenceTypes";
import { REST_CONVENTION_SECTIONS } from "./conventionSections";
import { REST_POSTS_SECTION } from "./postsSections";
import { REST_CONNECTIONS_SECTION } from "./connectionsSections";
import { REST_MEDIA_SECTION } from "./mediaSections";
import { REST_WEBHOOKS_SECTION } from "./webhooksSections";
import { REST_ACCOUNT_SECTION } from "./accountSections";

/**
 * Content model for the public /docs/rest reference page, assembled from
 * one module per resource. Every literal was extracted from the REST
 * source (zod validation schemas read in full, route handlers, DTO
 * factories), never from memory; each section carries sourceRefs. The
 * machine-readable twin of this page is the OpenAPI document at
 * /api/v1/openapi.json, which stays the schema-level source of truth.
 */

export const REST_OVERVIEW = {
  title: "REST API Reference",
  subtitle:
    "Schedule and publish social posts, manage connections, media, and webhooks with a standard Bearer-token API. One key, cursor pagination, a single error envelope.",
  baseUrl: "https://sharetopus.com/api/v1",
  // sourceRef: src/app/api/v1/openapi.json/route.ts (public spec endpoint)
  openApiUrl: "https://sharetopus.com/api/v1/openapi.json",
  note: "The OpenAPI 3.1 document at /api/v1/openapi.json is generated from the same zod schemas that validate requests at runtime; use it for codegen and the interactive explorer at /docs/api to try calls.",
} as const;

export const REST_DOCS_SECTIONS: DocsSection[] = [
  ...REST_CONVENTION_SECTIONS,
  REST_POSTS_SECTION,
  REST_CONNECTIONS_SECTION,
  REST_MEDIA_SECTION,
  REST_WEBHOOKS_SECTION,
  REST_ACCOUNT_SECTION,
];

export const REST_SIDEBAR_ITEMS = [
  { id: "overview", label: "Overview" },
  ...REST_DOCS_SECTIONS.map((section) => ({
    id: section.id,
    label: section.navLabel,
  })),
];
