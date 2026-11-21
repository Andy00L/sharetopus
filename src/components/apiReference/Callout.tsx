import { Info, TriangleAlert, type LucideIcon } from "lucide-react";

import type { CalloutTone } from "@/lib/docs/apiReferenceTypes";
import { cn } from "@/lib/utils";

const TONE_STYLES: Record<
  CalloutTone,
  { containerClass: string; iconClass: string; Icon: LucideIcon }
> = {
  warning: {
    containerClass: "border-[var(--orange)]/25 bg-[var(--orange)]/8",
    iconClass: "text-[var(--orange-2)]",
    Icon: TriangleAlert,
  },
  note: {
    containerClass: "border-border bg-[var(--cream-2)]/60",
    iconClass: "text-muted-foreground",
    Icon: Info,
  },
};

export function Callout({
  tone,
  className,
  children,
}: {
  tone: CalloutTone;
  className?: string;
  children: React.ReactNode;
}) {
  const { containerClass, iconClass, Icon } = TONE_STYLES[tone];
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg border p-3.5 text-sm text-[var(--ink-2)]",
        containerClass,
        className
      )}
    >
      <Icon
        aria-hidden
        className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconClass}`}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
