import type { PricingResult } from "@/app/(marketing)/(api-reference)/docs/x402/data/pricing";
import { TABLE_HEAD_CELL_CLASS } from "./tableClasses";

const AUTHORITATIVE_NOTE =
  "Prices are returned authoritatively in every 402 response; this table is informational.";

export function PricingTable({ result }: { result: PricingResult }) {
  if (!result.ok) {
    return <p className="text-sm text-[var(--ink-2)]">{AUTHORITATIVE_NOTE}</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="table w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-[var(--cream-2)]/50">
              <th className={TABLE_HEAD_CELL_CLASS}>
                Action
              </th>
              <th className={TABLE_HEAD_CELL_CLASS}>
                Display name
              </th>
              <th className={TABLE_HEAD_CELL_CLASS}>
                Price (USDC)
              </th>
              <th className={TABLE_HEAD_CELL_CLASS}>
                Recurrence
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr
                key={row.action}
                className={
                  rowIndex % 2 === 0 ? "bg-card" : "bg-[var(--cream)]/60"
                }
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px] font-medium text-foreground">
                  {row.action}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--ink-2)]">
                  {row.displayName}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-foreground">
                  {row.usdcPrice}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {row.recurrence}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {AUTHORITATIVE_NOTE}
      </p>
    </div>
  );
}
