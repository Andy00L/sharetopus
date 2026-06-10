"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface SidebarItem {
  id: string;
  label: string;
}

/**
 * Scroll-driven sidebar nav. An IntersectionObserver watches every section
 * id; the rootMargin pushes the observation band 96px down (under the
 * sticky offset, sections use scroll-mt-24) and cuts the bottom 55% off so
 * the section sitting under the header wins, not the one entering from the
 * bottom. No scroll libraries, no layout shift: only colors change.
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
            "block px-3 py-1.5 text-sm rounded-md transition-colors",
            activeId === item.id
              ? "bg-[#FF4A20]/10 text-[#FF4A20] font-medium"
              : "text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6]"
          )}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
