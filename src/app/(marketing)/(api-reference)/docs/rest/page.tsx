import type { Metadata } from "next";
import Link from "next/link";

import {
  REST_DOCS_SECTIONS,
  REST_OVERVIEW,
  REST_SIDEBAR_ITEMS,
} from "./data/endpoints";
import { Callout } from "@/components/apiReference/Callout";
import { CopyButton } from "@/components/apiReference/CopyButton";
import { ReferencePageShell } from "@/components/apiReference/ReferencePageShell";
import { SectionBlock } from "@/components/apiReference/SectionBlock";

export const metadata: Metadata = {
  title: "REST API Reference | Sharetopus",
  description:
    "Schedule and publish social posts via REST: Bearer API keys, cursor pagination, webhooks, media uploads, and analytics.",
};

/**
 * Public REST API reference. Fully static: assembled from the per-resource
 * content modules in data/, which mirror the zod validation schemas and
 * route handlers. The interactive explorer at /docs/api renders the same
 * surface from the generated OpenAPI document.
 */
export default function RestApiReferencePage() {
  return (
    <ReferencePageShell
      breadcrumbLabel="REST API Reference"
      eyebrow="Developer reference"
      title={REST_OVERVIEW.title}
      subtitle={REST_OVERVIEW.subtitle}
      sidebarItems={REST_SIDEBAR_ITEMS}
      headerExtras={
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-sm text-[var(--ink-2)]">
              {REST_OVERVIEW.baseUrl}
              <CopyButton
                text={REST_OVERVIEW.baseUrl}
                className="text-muted-foreground hover:text-foreground"
              />
            </span>
            <Link
              href="/docs/api"
              className="rounded-full bg-[var(--cream-2)] px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-[var(--line-2)]"
            >
              interactive explorer
            </Link>
            <a
              href={REST_OVERVIEW.openApiUrl}
              className="rounded-full bg-[var(--cream-2)] px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-[var(--line-2)]"
            >
              openapi.json
            </a>
          </div>
          <Callout tone="blue">{REST_OVERVIEW.note}</Callout>
        </>
      }
    >
      {REST_DOCS_SECTIONS.map((section) => (
        <SectionBlock key={section.id} section={section} />
      ))}
    </ReferencePageShell>
  );
}
