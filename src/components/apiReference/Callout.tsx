import { Info, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

const TONE_CLASSES = {
  amber: "border-[var(--orange)]/25 bg-[var(--orange)]/8",
  blue: "border-border bg-[var(--cream-2)]/60",
} as const;

export function Callout({
  tone,
  className,
  children,
}: {
  tone: keyof typeof TONE_CLASSES;
  className?: string;
  children: React.ReactNode;
}) {
  const ToneIcon = tone === "amber" ? TriangleAlert : Info;
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg border p-3.5 text-sm text-[var(--ink-2)]",
        TONE_CLASSES[tone],
        className
      )}
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
