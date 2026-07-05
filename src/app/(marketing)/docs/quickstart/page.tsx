import Content from "@/content/docs/quickstart.mdx";
import type { Metadata } from "next";
import { GuideArticle } from "@/components/apiReference/GuideArticle";

export const metadata: Metadata = {
  title: "Quickstart - Sharetopus Docs",
  description: "Schedule your first post in 5 minutes",
};

export default function QuickstartPage() {
  return (
    <GuideArticle eyebrow="Guide" slug="quickstart">
      <Content />
    </GuideArticle>
  );
}
