import { Info, TriangleAlert } from "lucide-react";

/**
 * Two callout tones per docs/UI_DESIGN_SYSTEM.md. "amber" (warnings: real
 * money, key handling) renders on the orange accent at whisper opacity;
 * "blue" (notes: idempotent behaviors, hints) renders on the layered cream.
 * The tone keys keep their historical names so the section data files and
 * the markdown builders stay untouched.
 */
const TONE_CLASSES = {
  amber: "border-[var(--orange)]/25 bg-[var(--orange)]/8",
  blue: "mt-4 border-border bg-[var(--cream-2)]/60",
} as const;

export function Callout({
  tone,
  children,
}: {
  tone: keyof typeof TONE_CLASSES;
  children: React.ReactNode;
}) {
  const ToneIcon = tone === "amber" ? TriangleAlert : Info;
  return (
    <div
      className={`flex gap-2.5 rounded-lg border p-3.5 text-sm text-[var(--ink-2)] ${TONE_CLASSES[tone]}`}
    >
      <ToneIcon
        aria-hidden
        className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
          tone === "amber" ? "text-[var(--orange-2)]" : "text-muted-foreground"
        }`}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
