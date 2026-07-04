import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docs - Sharetopus",
  description:
    "Sharetopus developer documentation: REST, x402, and MCP integration surfaces",
};

const guides = [
  {
    title: "Quickstart",
    description: "Schedule your first post in 5 minutes",
    href: "/docs/quickstart",
  },
  {
    title: "Authentication",
    description: "API keys, scopes, and security best practices",
    href: "/docs/authentication",
  },
  {
    title: "Webhooks",
    description: "Real-time event notifications via HTTPS",
    href: "/docs/webhooks",
  },
];

const references = [
  {
    title: "REST API Reference",
    description: "Every endpoint: posts, connections, media, webhooks, usage",
    href: "/docs/rest",
  },
  {
    title: "x402 API Reference",
    description: "Pay per action in USDC: no account, no API key",
    href: "/docs/x402",
  },
  {
    title: "MCP Server Reference",
    description: "18 tools for Claude Desktop, Cursor, and other MCP clients",
    href: "/docs/mcp",
  },
  {
    title: "Interactive explorer",
    description: "Try every REST endpoint against the live OpenAPI spec",
    href: "/docs/api",
  },
];

function CardGrid({
  items,
}: {
  items: { title: string; description: string; href: string }[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="block rounded-lg border border-border p-5 hover:bg-accent transition-colors"
        >
          <h2 className="font-semibold mb-1">{item.title}</h2>
          <p className="text-sm text-muted-foreground">{item.description}</p>
        </Link>
      ))}
    </div>
  );
}

export default function DocsLandingPage() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-6">
      <h1 className="text-3xl font-bold mb-4">Sharetopus Docs</h1>
      <p className="text-muted-foreground mb-8">
        Everything you need to integrate with Sharetopus: REST with an API
        key, x402 with per-request USDC payments, or the MCP server from an
        AI client.
      </p>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Guides
      </h2>
      <div className="mb-8">
        <CardGrid items={guides} />
      </div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        API references
      </h2>
      <CardGrid items={references} />
    </div>
  );
}
