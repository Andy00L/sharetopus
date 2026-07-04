import { cn } from "@/lib/utils";
import type { HttpMethod } from "@/lib/docs/apiReferenceTypes";

/**
 * Method badges on the brand palette (docs/UI_DESIGN_SYSTEM.md): POST is
 * the ink fill (the marketing dark-band recipe), GET the layered cream,
 * PATCH the white card with a hairline, DELETE the destructive tint. The
 * label text does the semantic work; color stays within the one-accent
 * system instead of the generic four-hue pastel set.
 */
const METHOD_CLASSES: Record<HttpMethod, string> = {
  GET: "bg-[var(--cream-2)] text-foreground border-[var(--line)]",
  POST: "bg-foreground text-[var(--cream)] border-foreground",
  PATCH: "bg-card text-foreground border-[var(--line)]",
  DELETE: "bg-destructive/10 text-destructive border-destructive/25",
};

export function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tracking-wide",
        METHOD_CLASSES[method]
      )}
    >
      {method}
    </span>
  );
}
