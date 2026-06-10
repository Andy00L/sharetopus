import type { EndpointOperation } from "../data/endpoints";
import { MethodBadge } from "./MethodBadge";
import { ParamTable } from "./ParamTable";
import { CodeCard } from "./CodeCard";
import { Callout } from "./Callout";
import { CopyButton } from "./CopyButton";

/**
 * One endpoint operation: left column carries the badge, copyable path,
 * description, param tables, and callouts; right column carries the code
 * cards. Collapses to one column below xl.
 */
export function EndpointBlock({ op }: { op: EndpointOperation }) {
  return (
    <div
      id={op.id}
      className="scroll-mt-24 py-10 border-b border-[#E5E7EB] last:border-b-0"
    >
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <MethodBadge method={op.method} />
            <h3 className="text-xl font-bold text-[#111827]">{op.title}</h3>
          </div>
          <div className="flex items-center gap-1.5 mb-3 font-mono text-sm text-[#6B7280]">
            <span>{op.path}</span>
            <CopyButton
              text={op.path}
              className="text-[#9CA3AF] hover:text-[#111827] transition-colors"
            />
          </div>
          <p className="text-[#374151] text-[15px] mb-5 leading-relaxed">
            {op.description}
          </p>
          <div>
            {op.paramTables.map((table) => (
              <ParamTable key={table.heading} table={table} />
            ))}
          </div>
          {op.callouts?.map((callout) =>
            // Amber callouts bring no top margin of their own (the blue
            // variant does), so they get a spacing wrapper here.
            callout.tone === "amber" ? (
              <div key={callout.text} className="mt-4">
                <Callout tone="amber">{callout.text}</Callout>
              </div>
            ) : (
              <Callout key={callout.text} tone="blue">
                {callout.text}
              </Callout>
            )
          )}
        </div>
        <div className="space-y-4">
          {op.codeSamples.map((sample) => (
            <CodeCard key={sample.label} label={sample.label} code={sample.code} />
          ))}
        </div>
      </div>
    </div>
  );
}
