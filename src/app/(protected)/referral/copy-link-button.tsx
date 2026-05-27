"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * Client component: copies the referral link to the clipboard and
 * shows a brief "Copied!" confirmation.
 */
export function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text in the code element (browsers that block clipboard)
      console.warn("[CopyLinkButton] Clipboard write failed");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-md bg-[#FF4A20] px-3 py-2 text-sm font-medium text-white hover:bg-[#FF4A20]/90 transition-colors"
    >
      {copied ? (
        <>
          <Check className="h-4 w-4" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-4 w-4" />
          Copy
        </>
      )}
    </button>
  );
}
