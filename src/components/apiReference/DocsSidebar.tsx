"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SidebarItem } from "@/lib/docs/apiReferenceTypes";

/** Docs sidebar that highlights the section under the sticky header (IntersectionObserver, 96px offset). */
export function DocsSidebar({ items }: { items: SidebarItem[] }) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0) return;

    // Activating the topmost visible section keeps fast scrolls from leaving a stale highlight.
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
            ([, leftTop], [, rightTop]) => leftTop - rightTop
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
