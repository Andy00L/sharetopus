"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SidebarItem } from "@/lib/docs/apiReferenceTypes";

/**
 * Scroll-driven sidebar nav. An IntersectionObserver watches every section
 * id; the rootMargin pushes the observation band 96px down (under the
 * sticky offset, sections use scroll-mt-24) and cuts the bottom 55% off so
 * the section sitting under the header wins, not the one entering from the
 * bottom. No scroll libraries, no layout shift: only colors change.
 *
 * Active state per docs/UI_DESIGN_SYSTEM.md: a 2px orange rail + ink text
 * on the layered cream. Orange text alone fails 4.5:1 on the cream field,
 * so the accent carries the rail, not the label.
 */
export function DocsSidebar({ items }: { items: SidebarItem[] }) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0) return;

    // Track every currently intersecting section by its viewport offset and
    // activate the topmost one, so fast scrolls never leave a stale highlight.
    const visibleTops = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleTops.set(entry.target.id, entry.boundingClientRect.top);
          } else {
            visibleTops.delete(entry.target.id);
          }
        }
        if (visibleTops.size > 0) {
          const topmost = [...visibleTops.entries()].sort(
            (a, b) => a[1] - b[1]
          )[0];
          setActiveId(topmost[0]);
        }
      },
      { rootMargin: "-96px 0px -55% 0px", threshold: 0 }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="API sections" className="sticky top-24 space-y-0.5">
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={cn(
            "block border-l-2 py-1.5 pl-3 pr-2 text-sm transition-colors",
            activeId === item.id
              ? "border-[var(--orange)] bg-[var(--cream-2)]/60 font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:border-[var(--line)] hover:text-foreground"
          )}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
