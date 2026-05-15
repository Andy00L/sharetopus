import Content from "@/content/docs/authentication.mdx";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Authentication - Sharetopus Docs",
  description: "API keys, scopes, and security",
};

export default function AuthenticationPage() {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-3xl mx-auto py-12 px-6">
      <Content />
    </article>
  );
}
