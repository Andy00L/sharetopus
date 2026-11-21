import type { ProofLedgerEntry } from "@/lib/x402/proof/proofLedger";
import {
  buildExplorerAddressUrl,
  buildExplorerTxUrl,
  networkDisplayName,
} from "@/lib/x402/proof/explorer";
import { ExplorerLink } from "./ExplorerLink";
import { OutcomeMark } from "./OutcomeMark";
import { TABLE_HEAD_CELL_CLASS } from "@/components/apiReference/tableClasses";
import { formatUsdc, formatUtcTimestamp, truncateMiddle } from "./ledgerFormat";

export function ProofLedgerTable({
  entries,
  showNetwork = false,
}: {
  entries: ProofLedgerEntry[];
  showNetwork?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-[var(--cream-2)]/50">
            <th className={TABLE_HEAD_CELL_CLASS}>Settled</th>
            {showNetwork ? (
              <th className={TABLE_HEAD_CELL_CLASS}>Network</th>
            ) : null}
            <th className={TABLE_HEAD_CELL_CLASS}>Action</th>
            <th className={`${TABLE_HEAD_CELL_CLASS} text-right`}>Amount</th>
            <th className={`${TABLE_HEAD_CELL_CLASS} hidden sm:table-cell`}>Payer</th>
            <th className={TABLE_HEAD_CELL_CLASS}>Post</th>
            <th className={TABLE_HEAD_CELL_CLASS}>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, rowIndex) => {
            const explorerName = `${networkDisplayName(entry.network)} explorer`;
            return (
              <tr
                key={`${entry.network}:${entry.txHash}`}
                className={rowIndex % 2 === 0 ? "bg-card" : "bg-[var(--cream)]/60"}
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-[var(--ink-2)]">
                  {formatUtcTimestamp(entry.settledAt)}
                </td>
                {showNetwork ? (
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-foreground">
                    {networkDisplayName(entry.network)}
                  </td>
                ) : null}
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px] font-medium text-foreground">
                  {entry.action}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-foreground">
                  {formatUsdc(entry.amountUsdc)}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">
                  <ExplorerLink
                    href={buildExplorerAddressUrl(entry.network, entry.payerAddress)}
                    title={entry.payerAddress}
                    ariaLabel={`Open payer ${entry.payerAddress} on the ${explorerName}`}
                  >
                    {truncateMiddle(entry.payerAddress, 4, 4)}
                  </ExplorerLink>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  <OutcomeMark outcome={entry.outcome} platform={entry.platform} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <ExplorerLink
                    href={buildExplorerTxUrl(entry.network, entry.txHash)}
                    title={entry.txHash}
                    ariaLabel={`Open transaction ${entry.txHash} on the ${explorerName}`}
                  >
                    {truncateMiddle(entry.txHash, 8, 8)}
                  </ExplorerLink>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
