import type { Metadata } from "next";

import {
  MCP_DOCS_SECTIONS,
  MCP_OVERVIEW,
  MCP_SIDEBAR_ITEMS,
} from "./data/sections";
import { MCP_ENDPOINTS } from "@/lib/docs/mcpCatalog";
import { Callout } from "@/components/apiReference/Callout";
import { CopyButton } from "@/components/apiReference/CopyButton";
import { ReferencePageShell } from "@/components/apiReference/ReferencePageShell";
import { SectionBlock } from "@/components/apiReference/SectionBlock";

export const metadata: Metadata = {
  title: "MCP Server Reference | Sharetopus",
  description:
    "Connect Claude Desktop, Cursor, or any MCP client to Sharetopus: 18 tools for posting, scheduling, media, and analytics.",
};

/**
 * Public MCP server reference. Fully static: every row comes from the
 * shared MCP catalog (src/lib/docs/mcpCatalog.ts), the same source the
 * markdown twin /docs/mcp.md renders.
 */
export default function McpReferencePage() {
  return (
    <ReferencePageShell
      breadcrumbLabel="MCP Server Reference"
      eyebrow="Developer reference"
      title={MCP_OVERVIEW.title}
      subtitle={MCP_OVERVIEW.subtitle}
      sidebarItems={MCP_SIDEBAR_ITEMS}
      headerExtras={
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-sm text-[var(--ink-2)]">
              {MCP_ENDPOINTS.streamableHttp}
              <CopyButton
                text={MCP_ENDPOINTS.streamableHttp}
                className="text-muted-foreground hover:text-foreground"
              />
            </span>
            <span className="rounded-full bg-[var(--cream-2)] px-3 py-1.5 font-mono text-xs text-foreground">
              streamable http
            </span>
            <span className="rounded-full bg-[var(--cream-2)] px-3 py-1.5 font-mono text-xs text-foreground">
              sse
            </span>
          </div>
          <Callout tone="blue">{MCP_OVERVIEW.planNote}</Callout>
        </>
      }
    >
      {MCP_DOCS_SECTIONS.map((section) => (
        <SectionBlock key={section.id} section={section} />
      ))}
    </ReferencePageShell>
  );
}
