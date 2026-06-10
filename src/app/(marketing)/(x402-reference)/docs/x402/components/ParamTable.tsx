import type { ParamTableData } from "../data/endpoints";

/**
 * Parameter table per the design contract. Rendered as a fragment so the
 * heading's first:mt-0 works against the parent flow: the first table in an
 * endpoint block sits flush, later ones get mt-5.
 */
export function ParamTable({ table }: { table: ParamTableData }) {
  return (
    <>
      <div className="text-xs font-semibold text-[#374151] uppercase tracking-wider mb-2 mt-5 first:mt-0">
        {table.heading}
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
        <table className="table w-full text-sm">
          <thead>
            <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
              <th className="text-left px-3 py-2 font-semibold text-[#374151]">
                Parameter
              </th>
              <th className="text-left px-3 py-2 font-semibold text-[#374151]">
                Type
              </th>
              <th className="text-left px-3 py-2 font-semibold text-[#374151]">
                Required
              </th>
              <th className="text-left px-3 py-2 font-semibold text-[#374151]">
                Description
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr
                key={row.name}
                className={index % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]"}
              >
                <td className="px-3 py-2 font-mono text-[12px] text-[#7C3AED] whitespace-nowrap">
                  {row.name}
                </td>
                <td className="px-3 py-2 text-[#6B7280] text-xs whitespace-nowrap">
                  {row.type}
                </td>
                <td className="px-3 py-2">
                  {row.required ? (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                      Required
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200">
                      Optional
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-[#374151] text-xs">
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
