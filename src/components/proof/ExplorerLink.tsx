import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

export function ExplorerLink({
  href,
  title,
  ariaLabel,
  children,
}: {
  href: string | null;
  title: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  if (href === null) {
    return (
      <span title={title} className="font-mono text-[12px] text-foreground">
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-sm font-mono text-[12px] text-foreground decoration-[var(--orange)] underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--orange)]"
    >
      {children}
      <ArrowUpRight aria-hidden className="h-3.5 w-3.5 text-[var(--orange)]" />
    </a>
  );
}
