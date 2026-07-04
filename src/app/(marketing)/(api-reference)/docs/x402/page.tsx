import type { Metadata } from "next";

import { DOCS_SECTIONS, OVERVIEW, SIDEBAR_ITEMS } from "./data/endpoints";
import { fetchX402Pricing } from "./data/pricing";
import { Callout } from "@/components/apiReference/Callout";
import { CopyButton } from "@/components/apiReference/CopyButton";
import { PricingTable } from "@/components/apiReference/PricingTable";
import { ReferencePageShell } from "@/components/apiReference/ReferencePageShell";
import { SectionBlock } from "@/components/apiReference/SectionBlock";

// Revalidate hourly so the live pricing table tracks pricing_actions without
// a rebuild. Same value as the OpenAPI route (src/app/api/v1/openapi.json).
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "x402 API Reference | Sharetopus",
  description:
    "Pay-per-action social posting API: USDC payments, wallet signatures, no account required.",
};

/**
 * Public x402 API reference. Server component: fetches the live pricing rows
 * and assembles the page from the static config in data/endpoints.ts. The
 * marketing layout already paints the cream field and DM Sans; components
 * read the token sheet (docs/UI_DESIGN_SYSTEM.md).
 */
export default async function X402ApiReferencePage() {
  const pricingResult = await fetchX402Pricing();

  return (
    <ReferencePageShell
      breadcrumbLabel="x402 API Reference"
      eyebrow="Developer reference"
      title={OVERVIEW.title}
      subtitle={OVERVIEW.subtitle}
      sidebarItems={SIDEBAR_ITEMS}
      headerExtras={
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-sm text-[var(--ink-2)]">
              {OVERVIEW.baseUrl}
              <CopyButton
                text={OVERVIEW.baseUrl}
                className="text-muted-foreground hover:text-foreground"
              />
            </span>
            {OVERVIEW.networks.map((network) => (
              <span
                key={network}
                className="rounded-full bg-[var(--cream-2)] px-3 py-1.5 font-mono text-xs text-foreground"
              >
                {network}
              </span>
            ))}
          </div>
          <Callout tone="amber">{OVERVIEW.callout}</Callout>
        </>
      }
    >
      {DOCS_SECTIONS.map((section) => (
        <SectionBlock key={section.id} section={section}>
          {section.id === "pricing" ? (
            <PricingTable result={pricingResult} />
          ) : null}
        </SectionBlock>
      ))}
    </ReferencePageShell>
  );
}
