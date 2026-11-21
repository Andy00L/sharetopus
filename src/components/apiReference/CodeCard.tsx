import { cn } from "@/lib/utils";
import { CopyButton } from "./CopyButton";

export function CodeCard({
  label,
  code,
  featured = false,
}: {
  label: string;
  code: string;
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl bg-foreground",
        featured
          ? "border border-foreground shadow-[var(--shadow-hard)]"
          : "border border-foreground/90"
      )}
    >
      <div className="flex items-center justify-between border-b border-[var(--cream)]/10 bg-[var(--cream)]/5 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--cream)]/55">
          {label}
        </span>
        {featured && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-[var(--orange)]"
          />
        )}
      </div>
      <div className="group relative">
        <CopyButton
          text={code}
          className="absolute right-2 top-2 text-[var(--cream)]/40 opacity-0 transition-opacity hover:text-[var(--cream)] group-hover:opacity-100"
        />
        <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-[var(--cream-2)]">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
