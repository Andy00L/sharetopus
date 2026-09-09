import type { SolanaLedgerEntry } from "@/lib/x402/solana/proofLedger";
import {
  buildSolanaExplorerAddressUrl,
  buildSolanaExplorerTxUrl,
} from "@/lib/x402/solana/explorer";
import { ExplorerLink } from "./ExplorerLink";
import { OutcomeMark } from "./OutcomeMark";
import { formatUsdc, formatUtcTimestamp, truncateMiddle } from "./ledgerFormat";

/** Same head cell recipe as PricingTable (src/components/apiReference). */
const HEAD_CELL_CLASS =
  "px-3 py-2 text-left font-semibold text-[var(--ink-2)]";

/**
 * The ledger: one row per Solana settlement, newest first. Every signature
 * and payer is a link to Solana Explorer, so the proof is one click away
 * and never a screenshot. Payer collapses below sm so the signature column
 * keeps its width on a phone.
 */
export function SolanaLedgerTable({
  entries,
}: {
  entries: SolanaLedgerEntry[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-[var(--cream-2)]/50">
            <th className={HEAD_CELL_CLASS}>Settled</th>
            <th className={HEAD_CELL_CLASS}>Action</th>
            <th className={`${HEAD_CELL_CLASS} text-right`}>Amount</th>
            <th className={`${HEAD_CELL_CLASS} hidden sm:table-cell`}>Payer</th>
            <th className={HEAD_CELL_CLASS}>Post</th>
            <th className={HEAD_CELL_CLASS}>Signature</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, rowIndex) => (
            <tr
              key={entry.txSignature}
              className={rowIndex % 2 === 0 ? "bg-card" : "bg-[var(--cream)]/60"}
            >
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-[var(--ink-2)]">
                {formatUtcTimestamp(entry.settledAt)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px] font-medium text-foreground">
                {entry.action}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-foreground">
                {formatUsdc(entry.amountUsdc)}
              </td>
              <td className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">
                <ExplorerLink
                  href={buildSolanaExplorerAddressUrl(entry.payerAddress)}
                  title={entry.payerAddress}
                  ariaLabel={`Open payer ${entry.payerAddress} on Solana Explorer`}
                >
                  {truncateMiddle(entry.payerAddress, 4, 4)}
                </ExplorerLink>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                <OutcomeMark outcome={entry.outcome} platform={entry.platform} />
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <ExplorerLink
                  href={buildSolanaExplorerTxUrl(entry.txSignature)}
                  title={entry.txSignature}
                  ariaLabel={`Open transaction ${entry.txSignature} on Solana Explorer`}
                >
                  {truncateMiddle(entry.txSignature, 8, 8)}
                </ExplorerLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
