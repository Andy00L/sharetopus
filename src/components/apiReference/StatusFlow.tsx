import { Fragment } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Connection status pills: the happy path chained with chevrons, then the
 * terminal alternatives as destructive-tinted pills on a second row.
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
        {steps.map((step, stepIndex) => (
          <Fragment key={step}>
            {stepIndex > 0 && (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="rounded-md bg-[var(--cream-2)] px-2.5 py-1 font-mono text-foreground">
              {step}
            </span>
          </Fragment>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          terminal alternatives:
        </span>
        {terminal.map((terminalState) => (
          <span
            key={terminalState}
            className="rounded-md bg-destructive/10 px-2.5 py-1 font-mono text-destructive"
          >
            {terminalState}
          </span>
        ))}
      </div>
    </div>
  );
}
