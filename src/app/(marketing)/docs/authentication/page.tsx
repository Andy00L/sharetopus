import Content from "@/content/docs/authentication.mdx";
import type { Metadata } from "next";
import { GuideArticle } from "@/components/apiReference/GuideArticle";

export const metadata: Metadata = {
  title: "Authentication - Sharetopus Docs",
  description: "API keys, scopes, and security",
};

export default function AuthenticationPage() {
  return (
    <GuideArticle eyebrow="Guide" slug="authentication">
      <Content />
    </GuideArticle>
  );
}
