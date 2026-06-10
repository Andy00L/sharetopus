import type { PricingResult } from "../data/pricing";

// The one-line truth that survives any fetch outcome: the 402 response is
// the pricing authority, this table is a convenience.
const AUTHORITATIVE_NOTE =
  "Prices are returned authoritatively in every 402 response; this table is informational.";

/**
 * Live pricing table rendered from pricing_actions at build/revalidate time.
 * On fetch failure the table is replaced by the single authoritative-pricing
 * line, nothing else.
 */
export function PricingTable({ result }: { result: PricingResult }) {
  if (!result.ok) {
    return <p className="text-[#374151] text-sm">{AUTHORITATIVE_NOTE}</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
        <table className="table w-full text-sm">
          <thead>
            <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
              <th className="text-left px-3 py-2 font-semibold text-[#374151]">
                Action
              </th>
              <th className="text-left px-3 py-2 font-semibold text-[#374151]">
                Display name
              </th>
              <th className="text-left px-3 py-2 font-semibold text-[#374151]">
                Price (USDC)
              </th>
              <th className="text-left px-3 py-2 font-semibold text-[#374151]">
                Recurrence
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr
                key={row.action}
                className={index % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]"}
              >
                <td className="px-3 py-2 font-mono text-[12px] text-[#7C3AED] whitespace-nowrap">
                  {row.action}
                </td>
                <td className="px-3 py-2 text-[#374151] text-xs">
                  {row.displayName}
                </td>
                <td className="px-3 py-2 text-[#374151] text-xs whitespace-nowrap">
                  {row.usdcPrice}
                </td>
                <td className="px-3 py-2 text-[#6B7280] text-xs whitespace-nowrap">
                  {row.recurrence}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[#6B7280] text-xs mt-3">{AUTHORITATIVE_NOTE}</p>
    </div>
  );
}
