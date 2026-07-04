import type { SectionTable } from "@/lib/docs/apiReferenceTypes";

/**
 * Plain section-level table (networks, error codes, rate limits, tool
 * lists). Same visual contract as the param tables, but with
 * config-driven columns. The first column renders mono (it always
 * carries an identifier: network short name, error code, tool name).
 */
export function SectionTableView({ table }: { table: SectionTable }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="table w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-[var(--cream-2)]/50">
            {table.columns.map((column) => (
              <th
                key={column}
                className="px-3 py-2 text-left font-semibold text-[var(--ink-2)]"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr
              key={row.join("|")}
              className={
                rowIndex % 2 === 0 ? "bg-card" : "bg-[var(--cream)]/60"
              }
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={`${cellIndex}-${cell}`}
                  className={
                    cellIndex === 0
                      ? "whitespace-nowrap px-3 py-2 font-mono text-[12px] font-medium text-foreground"
                      : "px-3 py-2 text-xs text-[var(--ink-2)]"
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
