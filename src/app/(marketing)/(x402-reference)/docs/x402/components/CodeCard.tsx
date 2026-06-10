import { CopyButton } from "./CopyButton";

/**
 * Dark code card. Label examples: "Example Request", "Response · 402" (the
 * middle dot separates word and status, per the design contract). The copy
 * button fades in on hover over the card body.
 */
export function CodeCard({ label, code }: { label: string; code: string }) {
  return (
    <div className="rounded-lg border border-[#2D2D2D] bg-[#1A1A2E] overflow-hidden">
      <div className="px-4 py-2 bg-[#1E1E32] border-b border-[#2D2D2D] text-xs font-medium text-gray-400 uppercase tracking-wider">
        {label}
      </div>
      <div className="relative group">
        <CopyButton
          text={code}
          className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-200"
        />
        <pre className="p-4 overflow-x-auto text-[13px] leading-relaxed text-gray-300">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
