import Content from "@/content/docs/quickstart.mdx";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Quickstart - Sharetopus Docs",
  description: "Schedule your first post in 5 minutes",
};

export default function QuickstartPage() {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-3xl mx-auto py-12 px-6">
      <Content />
    </article>
  );
}
