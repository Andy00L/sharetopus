import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docs - Sharetopus",
  description: "Sharetopus REST API documentation",
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
  {
    title: "API Reference",
    description: "Interactive explorer for all endpoints",
    href: "/docs/api",
  },
];

export default function DocsLandingPage() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-6">
      <h1 className="text-3xl font-bold mb-4">Sharetopus Docs</h1>
      <p className="text-muted-foreground mb-8">
        Everything you need to integrate with the Sharetopus REST API.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {guides.map((guide) => (
          <Link
            key={guide.href}
            href={guide.href}
            className="block rounded-lg border border-border p-5 hover:bg-accent transition-colors"
          >
            <h2 className="font-semibold mb-1">{guide.title}</h2>
            <p className="text-sm text-muted-foreground">
              {guide.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
