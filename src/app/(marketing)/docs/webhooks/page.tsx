import Content from "@/content/docs/webhooks.mdx";
import type { Metadata } from "next";
import { GuideArticle } from "@/components/apiReference/GuideArticle";

export const metadata: Metadata = {
  title: "Webhooks - Sharetopus Docs",
  description: "Real-time event notifications",
};

export default function WebhooksDocsPage() {
  return (
    <GuideArticle eyebrow="Guide" slug="webhooks">
      <Content />
    </GuideArticle>
  );
}
