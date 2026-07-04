import type { ParamTableData } from "@/lib/docs/apiReferenceTypes";

/**
 * Parameter table on the brand tokens: mono ink names (no second accent),
 * white/cream zebra, hairline borders. Required reads as bold ink,
 * optional as muted: the strongest scanning signal without adding a hue.
 * Rendered as a fragment so the heading's first:mt-0 works against the
 * parent flow: the first table in an endpoint block sits flush, later
 * ones get mt-5.
 */
export function ParamTable({ table }: { table: ParamTableData }) {
  return (
    <>
      <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-2)] first:mt-0">
        {table.heading}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="table w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-[var(--cream-2)]/50">
              <th className="px-3 py-2 text-left font-semibold text-[var(--ink-2)]">
                Parameter
              </th>
              <th className="px-3 py-2 text-left font-semibold text-[var(--ink-2)]">
                Type
              </th>
              <th className="px-3 py-2 text-left font-semibold text-[var(--ink-2)]">
                Required
              </th>
              <th className="px-3 py-2 text-left font-semibold text-[var(--ink-2)]">
                Description
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr
                key={row.name}
                className={
                  rowIndex % 2 === 0 ? "bg-card" : "bg-[var(--cream)]/60"
                }
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px] font-medium text-foreground">
                  {row.name}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {row.type}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-[11px]">
                  {row.required ? (
                    <span className="font-semibold uppercase tracking-wide text-foreground">
                      Required
                    </span>
                  ) : (
                    <span className="uppercase tracking-wide text-muted-foreground">
                      Optional
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--ink-2)]">
                  {row.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
