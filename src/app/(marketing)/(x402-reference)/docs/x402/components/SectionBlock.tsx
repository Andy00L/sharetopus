import type { DocsSection } from "../data/endpoints";
import { Callout } from "./Callout";
import { CodeCard } from "./CodeCard";
import { EndpointBlock } from "./EndpointBlock";
import { SectionTableView } from "./SectionTableView";
import { StatusFlow } from "./StatusFlow";

/**
 * One page section, fully driven by the DocsSection config. Optional blocks
 * render in a fixed order: flow narrative + cards, status pills, section
 * table, injected children (the live pricing table), endpoint operations,
 * section-level code cards, callouts.
 */
export function SectionBlock({
  section,
  children,
}: {
  section: DocsSection;
  children?: React.ReactNode;
}) {
  return (
    <section
      id={section.id}
      className="scroll-mt-24 pt-8 pb-10 border-b border-[#E5E7EB] last:border-b-0"
    >
      <h2 className="text-2xl font-bold text-[#111827] mb-2">
        {section.title}
      </h2>
      <p className="text-[#6B7280] text-[15px] mb-8">{section.summary}</p>

      {section.flowSteps && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          <ol className="space-y-5">
            {section.flowSteps.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#111827] text-white text-xs font-bold flex items-center justify-center mt-0.5">
                  {index + 1}
                </span>
                <div>
                  <span className="font-semibold text-[#111827] text-sm">
                    {step.title}
                  </span>
                  <p className="text-[#374151] text-sm leading-relaxed mt-1">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <div className="space-y-4">
            {section.flowCodeSamples?.map((sample) => (
              <CodeCard
                key={sample.label}
                label={sample.label}
                code={sample.code}
              />
            ))}
          </div>
        </div>
      )}

      {section.statusFlow && (
        <div className="mb-8">
          <StatusFlow
            steps={section.statusFlow.steps}
            terminal={section.statusFlow.terminal}
          />
        </div>
      )}

      {section.table && <SectionTableView table={section.table} />}
      {section.tableNote && (
        <p className="text-[#6B7280] text-xs mt-3">{section.tableNote}</p>
      )}

      {children}

      {section.operations?.map((op) => (
        <EndpointBlock key={`${op.path}-${op.title}`} op={op} />
      ))}

      {section.codeSamples && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
          {section.codeSamples.map((sample) => (
            <CodeCard
              key={sample.label}
              label={sample.label}
              code={sample.code}
            />
          ))}
        </div>
      )}

      {section.callouts?.map((callout) =>
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
    </section>
  );
}
