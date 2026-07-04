import type { DocsSection } from "@/lib/docs/apiReferenceTypes";
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
      className="scroll-mt-24 border-b border-border pb-10 pt-8 last:border-b-0"
    >
      <h2 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
        {section.title}
      </h2>
      <p className="mb-8 text-[15px] text-[var(--ink-2)]">{section.summary}</p>

      {section.flowSteps && (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <ol className="space-y-5">
            {section.flowSteps.map((step, stepIndex) => (
              <li key={step.title} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-foreground font-mono text-xs font-bold text-[var(--cream)]">
                  {stepIndex + 1}
                </span>
                <div>
                  <span className="text-sm font-semibold text-foreground">
                    {step.title}
                  </span>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--ink-2)]">
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
                featured={sample.featured}
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
        <p className="mt-3 text-xs text-muted-foreground">
          {section.tableNote}
        </p>
      )}

      {children}

      {section.operations?.map((op) => (
        <EndpointBlock key={`${op.method}-${op.path}-${op.title}`} op={op} />
      ))}

      {section.codeSamples && (
        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {section.codeSamples.map((sample) => (
            <CodeCard
              key={sample.label}
              label={sample.label}
              code={sample.code}
              featured={sample.featured}
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
