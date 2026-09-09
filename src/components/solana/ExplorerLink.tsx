import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

/**
 * External link to Solana Explorer, the ledger's one interactive element.
 * Mono ink text clears 4.5:1 on white and cream (orange text at 12px does
 * not); the orange up-right arrow is the interactive mark, and hover or
 * focus adds an orange underline. One focus treatment for the whole page.
 * Opens in a new tab.
 */
export function ExplorerLink({
  href,
  title,
  ariaLabel,
  children,
}: {
  href: string;
  title: string;
  ariaLabel: string;
  children: ReactNode;
}) {
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
