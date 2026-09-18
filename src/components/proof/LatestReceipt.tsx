import type { CSSProperties, ReactNode } from "react";

import type { ProofLedgerEntry } from "@/lib/x402/proof/proofLedger";
import {
  buildExplorerAddressUrl,
  buildExplorerTxUrl,
  networkDisplayName,
} from "@/lib/x402/proof/explorer";
import { cn } from "@/lib/utils";
import { ExplorerLink } from "./ExplorerLink";
import { OutcomeMark } from "./OutcomeMark";
import { formatUsdc, formatUtcTimestamp, truncateMiddle } from "./ledgerFormat";

export type ReceiptState =
  | { kind: "entry"; entry: ProofLedgerEntry }
  | { kind: "empty" }
  | { kind: "unavailable" };

/** Tooth size of the torn edge, in px. Twelve reads as paper, not a saw. */
const TOOTH_PX = 12;

/**
 * A row of downward teeth in the fill color along the top of a strip: two
 * 45-degree gradients per tile paint the top-left and top-right corner
 * triangles, so adjacent tiles form one tooth each and the strip's own top
 * edge stays solid where it meets the card body.
 */
function buildTornEdgeStyle(fill: string): CSSProperties {
  const toothCut = `${TOOTH_PX / 2}px`;
  return {
    backgroundImage: `linear-gradient(135deg, ${fill} ${toothCut}, transparent 0), linear-gradient(-135deg, ${fill} ${toothCut}, transparent 0)`,
    backgroundSize: `${TOOTH_PX}px ${TOOTH_PX}px`,
    backgroundRepeat: "repeat-x",
    backgroundPosition: "left top",
  };
}

/**
 * The receipt silhouette: a body with a torn bottom edge, filled in one
 * color. Rendered twice: once in ink, offset by the stamp distance, as the
 * page's one hard shadow, and once in the card color on top with content.
 */
function ReceiptShape({
  fill,
  className,
  bodyClassName,
  isDecorative = false,
  children,
}: {
  fill: string;
  className?: string;
  bodyClassName?: string;
  isDecorative?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={className} aria-hidden={isDecorative || undefined}>
      <div className={cn("rounded-t-xl", bodyClassName)} style={{ background: fill }}>
        {children}
      </div>
      <div style={{ height: TOOTH_PX, ...buildTornEdgeStyle(fill) }} />
    </div>
  );
}

/**
 * The latest settlement as a printed receipt. It carries the page's single
 * ink stamp (docs/UI_DESIGN_SYSTEM.md, "The proof ledger"), cast by
 * the whole silhouette so the tear shows in the shadow too. Three states,
 * each designed: a settlement, none yet, or the ledger being unreadable.
 */
export function LatestReceipt({ state }: { state: ReceiptState }) {
  return (
    <div className="relative">
      <ReceiptShape
        fill="var(--ink)"
        className="absolute inset-0 translate-x-1.5 translate-y-1.5"
        isDecorative
      />
      <ReceiptShape
        fill="var(--card)"
        className="relative"
        bodyClassName="border border-b-0 border-foreground px-5 pt-4 pb-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="t-eyebrow">Latest settlement</p>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--orange)]" />
        </div>
        {state.kind === "entry" ? (
          <ReceiptBody entry={state.entry} />
        ) : state.kind === "empty" ? (
          <ReceiptNotice
            headline="No settlement yet."
            detail="The first paid call prints here with its signature."
          />
        ) : (
          <ReceiptNotice
            headline="Ledger unavailable."
            detail="Settlements still verify on-chain. Try again in a minute."
          />
        )}
      </ReceiptShape>
    </div>
  );
}

function ReceiptNotice({ headline, detail }: { headline: string; detail: string }) {
  return (
    <div className="py-2">
      <p className="font-mono text-lg text-foreground">{headline}</p>
      <p className="mt-2 text-sm text-[var(--ink-2)]">{detail}</p>
    </div>
  );
}

function ReceiptBody({ entry }: { entry: ProofLedgerEntry }) {
  const networkLabel = networkDisplayName(entry.network);
  const explorerName = `${networkLabel} explorer`;
  const receiptLines: { label: string; value: ReactNode }[] = [
    { label: "Network", value: <span className="font-mono text-[12px]">{networkLabel}</span> },
    { label: "Action", value: <span className="font-mono text-[12px]">{entry.action}</span> },
    {
      label: "Post",
      value: <OutcomeMark outcome={entry.outcome} platform={entry.platform} />,
    },
    {
      label: "Payer",
      value: (
        <ExplorerLink
          href={buildExplorerAddressUrl(entry.network, entry.payerAddress)}
          title={entry.payerAddress}
          ariaLabel={`Open payer ${entry.payerAddress} on the ${explorerName}`}
        >
          {truncateMiddle(entry.payerAddress, 4, 4)}
        </ExplorerLink>
      ),
    },
    {
      label: "Settled",
      value: (
        <span className="font-mono text-[12px] tabular-nums">
          {formatUtcTimestamp(entry.settledAt)}
        </span>
      ),
    },
    {
      label: "Transaction",
      value: (
        <ExplorerLink
          href={buildExplorerTxUrl(entry.network, entry.txHash)}
          title={entry.txHash}
          ariaLabel={`Open transaction ${entry.txHash} on the ${explorerName}`}
        >
          {truncateMiddle(entry.txHash, 8, 8)}
        </ExplorerLink>
      ),
    },
  ];

  return (
    <div>
      <p className="font-mono text-3xl font-semibold tabular-nums text-foreground">
        {formatUsdc(entry.amountUsdc)}
      </p>
      <dl className="mt-4">
        {receiptLines.map((line) => (
          <div
            key={line.label}
            className="flex items-center justify-between gap-4 border-t border-dashed border-border py-2 text-sm"
          >
            <dt className="text-[var(--ink-2)]">{line.label}</dt>
            <dd className="text-right text-foreground">{line.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
