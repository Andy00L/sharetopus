import type { LedgerOutcome } from "@/lib/x402/proof/proofLedger";

/**
 * The one outcome vocabulary of the proof ledger: a 6px dot and a
 * word, never a pill (docs/UI_DESIGN_SYSTEM.md, "The proof ledger").
 * Solid ink means done, a hollow muted ring means still moving, destructive
 * means the money or the post went wrong.
 */
const OUTCOME_PRESENTATION: Record<
  LedgerOutcome,
  { label: string; dotClassName: string }
> = {
  published: { label: "Published", dotClassName: "bg-foreground" },
  publishing: {
    label: "Publishing",
    dotClassName: "border border-muted-foreground",
  },
  scheduled: {
    label: "Scheduled",
    dotClassName: "border border-muted-foreground",
  },
  unlinked: {
    label: "Not linked",
    dotClassName: "border border-muted-foreground",
  },
  failed: { label: "Failed", dotClassName: "bg-destructive" },
  refunded: { label: "Refunded", dotClassName: "bg-destructive" },
  cancelled: { label: "Cancelled", dotClassName: "border border-destructive" },
  no_post: { label: "No post", dotClassName: "border border-border" },
};

export function OutcomeMark({
  outcome,
  platform,
}: {
  outcome: LedgerOutcome;
  platform: string | null;
}) {
  const presentation = OUTCOME_PRESENTATION[outcome];
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-foreground">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation.dotClassName}`}
      />
      <span>{presentation.label}</span>
      {platform ? (
        <span className="font-mono text-[12px] text-[var(--ink-2)]">
          {platform}
        </span>
      ) : null}
    </span>
  );
}
