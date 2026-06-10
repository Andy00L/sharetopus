import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { DOCS_SECTIONS, OVERVIEW, SIDEBAR_ITEMS } from "./data/endpoints";
import { fetchX402Pricing } from "./data/pricing";
import { Callout } from "./components/Callout";
import { DocsSidebar } from "./components/DocsSidebar";
import { PricingTable } from "./components/PricingTable";
import { SectionBlock } from "./components/SectionBlock";

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
 * marketing layout already paints the page background and fonts.
 */
export default async function X402ApiReferencePage() {
  const pricingResult = await fetchX402Pricing();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center gap-2 text-sm text-[#6B7280] mb-6">
        <Link href="/" className="hover:text-[#111827] transition-colors">
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[#111827] font-medium">x402 API Reference</span>
      </div>

      <div className="flex gap-8">
        <aside className="hidden lg:block w-48 flex-shrink-0 bg-[#EEEFE8]">
          <DocsSidebar items={SIDEBAR_ITEMS} />
        </aside>

        <div className="flex-1 min-w-0">
          <div
            id="overview"
            className="scroll-mt-24 pb-10 border-b border-[#E5E7EB]"
          >
            <h1 className="text-4xl font-bold text-[#111827] mb-3">
              {OVERVIEW.title}
            </h1>
            <p className="text-lg text-[#6B7280] max-w-2xl mb-6">
              {OVERVIEW.subtitle}
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-6">
              <span className="text-sm font-mono bg-[#F3F4F6] px-3 py-1.5 rounded-lg text-[#374151] border border-[#E5E7EB]">
                Base URL: {OVERVIEW.baseUrl}
              </span>
              {OVERVIEW.networks.map((network) => (
                <span
                  key={network}
                  className="text-sm font-mono bg-[#F3F4F6] px-3 py-1.5 rounded-lg text-[#374151] border border-[#E5E7EB]"
                >
                  {network}
                </span>
              ))}
            </div>
            <Callout tone="amber">{OVERVIEW.callout}</Callout>
          </div>

          {DOCS_SECTIONS.map((section) => (
            <SectionBlock key={section.id} section={section}>
              {section.id === "pricing" ? (
                <PricingTable result={pricingResult} />
              ) : null}
            </SectionBlock>
          ))}
        </div>
      </div>
    </div>
  );
}
