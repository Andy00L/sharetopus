import { Fragment } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Connection status pills: the happy path chained with chevrons, then the
 * terminal alternatives as red pills on a second row.
 */
export function StatusFlow({
  steps,
  terminal,
}: {
  steps: string[];
  terminal: string[];
}) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, index) => (
          <Fragment key={step}>
            {index > 0 && <ChevronRight className="h-4 w-4 text-[#9CA3AF]" />}
            <span className="bg-[#F3F4F6] px-2.5 py-1 rounded font-mono text-[#374151]">
              {step}
            </span>
          </Fragment>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[#6B7280] text-xs">terminal alternatives:</span>
        {terminal.map((step) => (
          <span
            key={step}
            className="bg-red-50 text-red-600 px-2.5 py-1 rounded font-mono"
          >
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}
