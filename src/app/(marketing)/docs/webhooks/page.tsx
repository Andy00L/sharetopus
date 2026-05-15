import Content from "@/content/docs/webhooks.mdx";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Webhooks - Sharetopus Docs",
  description: "Real-time event notifications",
};

export default function WebhooksDocsPage() {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-3xl mx-auto py-12 px-6">
      <Content />
    </article>
  );
}
