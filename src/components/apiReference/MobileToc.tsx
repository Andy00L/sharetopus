import type { SidebarItem } from "@/lib/docs/apiReferenceTypes";

/**
 * Small-screen table of contents: a sticky, horizontally scrollable pill
 * row replacing the sidebar below lg. Server-rendered anchors only, no
 * scroll-spy (the band is too short to show an active state without
 * jitter while scrolling).
 */
export function MobileToc({ items }: { items: SidebarItem[] }) {
  return (
    <nav
      aria-label="API sections"
      className="sticky top-0 z-10 -mx-4 mb-6 border-b border-border bg-[var(--cream)]/90 px-4 py-2 backdrop-blur-sm lg:hidden"
    >
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="whitespace-nowrap rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--line)] hover:text-foreground"
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
