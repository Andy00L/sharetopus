"use client";

import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { cn } from "@/lib/utils";

type CopyState = "idle" | "copied" | "error";

export function CopyButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch (copyError) {
      console.error(
        "[CopyButton] Clipboard write failed:",
        copyError instanceof Error ? copyError.message : copyError
      );
      setState("error");
    }
    window.setTimeout(() => setState("idle"), 1500);
  };

  return (
    <button
      type="button"
      aria-label="Copy"
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center justify-center rounded p-1 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--orange)]",
        className
      )}
    >
      {state === "copied" ? (
        <Check className="h-3.5 w-3.5 text-[var(--orange)]" />
      ) : state === "error" ? (
        <X className="h-3.5 w-3.5 text-destructive" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
