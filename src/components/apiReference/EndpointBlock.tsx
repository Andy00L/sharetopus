import type { EndpointOperation } from "@/lib/docs/apiReferenceTypes";
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
      className="scroll-mt-24 border-b border-border py-10 last:border-b-0"
    >
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-2.5">
            <MethodBadge method={op.method} />
            <h3 className="text-xl font-bold tracking-tight text-foreground">
              {op.title}
            </h3>
          </div>
          <div className="mb-3 flex items-center gap-1.5 font-mono text-sm text-muted-foreground">
            <span>{op.path}</span>
            <CopyButton
              text={op.path}
              className="text-muted-foreground hover:text-foreground"
            />
          </div>
          <p className="mb-5 text-[15px] leading-relaxed text-[var(--ink-2)]">
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
            <CodeCard
              key={sample.label}
              label={sample.label}
              code={sample.code}
              featured={sample.featured}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
