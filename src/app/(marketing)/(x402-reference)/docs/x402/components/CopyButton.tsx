"use client";

import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { cn } from "@/lib/utils";

type CopyState = "idle" | "copied" | "error";

/**
 * Icon-only copy-to-clipboard button. No toast, no storage: the state lives
 * in the component and resets after 1.5s so repeated copies keep giving
 * feedback. Errors are values here too; a denied clipboard (permissions,
 * insecure context) swaps to a brief error icon instead of throwing.
 */
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
    } catch (err) {
      console.error(
        "[CopyButton] Clipboard write failed:",
        err instanceof Error ? err.message : err
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
      className={cn("inline-flex items-center justify-center p-1", className)}
    >
      {state === "copied" ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : state === "error" ? (
        <X className="h-3.5 w-3.5 text-red-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
