import type { SectionTable } from "@/lib/docs/apiReferenceTypes";
import { TABLE_HEAD_CELL_CLASS } from "./tableClasses";

const IDENTIFIER_COLUMN_INDEX = 0;

export function SectionTableView({ table }: { table: SectionTable }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="table w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-[var(--cream-2)]/50">
            {table.columns.map((column) => (
              <th
                key={column}
                className={TABLE_HEAD_CELL_CLASS}
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
                    cellIndex === IDENTIFIER_COLUMN_INDEX
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
