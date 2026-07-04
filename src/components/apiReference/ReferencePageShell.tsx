import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type { SidebarItem } from "@/lib/docs/apiReferenceTypes";
import { DocsSidebar } from "./DocsSidebar";
import { MobileToc } from "./MobileToc";

/**
 * Shared scaffolding for the API reference family (/docs/x402, /docs/rest,
 * /docs/mcp): breadcrumb, eyebrow + display title + subtitle header,
 * optional header extras (chip rows, callouts), the scroll-spy sidebar on
 * lg+ and the pill TOC below it. Pages supply sections as children.
 */
export function ReferencePageShell({
  breadcrumbLabel,
  eyebrow,
  title,
  subtitle,
  headerExtras,
  sidebarItems,
  children,
}: {
  breadcrumbLabel: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  headerExtras?: React.ReactNode;
  sidebarItems: SidebarItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="transition-colors hover:text-foreground">
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href="/docs" className="transition-colors hover:text-foreground">
          Docs
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">{breadcrumbLabel}</span>
      </div>

      <MobileToc items={sidebarItems} />

      <div className="flex gap-10">
        <aside className="hidden w-52 flex-shrink-0 lg:block">
          <DocsSidebar items={sidebarItems} />
        </aside>

        <div className="min-w-0 flex-1">
          <div
            id="overview"
            className="scroll-mt-24 border-b border-border pb-10"
          >
            <p className="t-eyebrow mb-3">{eyebrow}</p>
            <h1 className="font-display mb-3 text-4xl text-foreground">
              {title}
            </h1>
            <p className="mb-6 max-w-2xl text-lg leading-relaxed text-[var(--ink-2)]">
              {subtitle}
            </p>
            {headerExtras}
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
