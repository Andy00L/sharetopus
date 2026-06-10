import type { SectionTable } from "../data/endpoints";

/**
 * Plain section-level table (networks, error codes, rate limits). Same
 * visual contract as the param tables, but with config-driven columns.
 * The first column renders mono (it always carries an identifier: network
 * short name, error code, rate-limit scope).
 */
export function SectionTableView({ table }: { table: SectionTable }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
      <table className="table w-full text-sm">
        <thead>
          <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
            {table.columns.map((column) => (
              <th
                key={column}
                className="text-left px-3 py-2 font-semibold text-[#374151]"
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
              className={rowIndex % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]"}
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={`${cellIndex}-${cell}`}
                  className={
                    cellIndex === 0
                      ? "px-3 py-2 font-mono text-[12px] text-[#374151] whitespace-nowrap"
                      : "px-3 py-2 text-[#374151] text-xs"
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
