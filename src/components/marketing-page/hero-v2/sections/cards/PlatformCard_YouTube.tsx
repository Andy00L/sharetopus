import { PostMedia } from "../PostMedia";

/* YouTube Shorts mockup card.
   Full-bleed gradient PostMedia background.
   Top: YouTube red logo + "Shorts" label.
   Right rail: thumbs-up/dislike/comment/share with counts.
   Bottom: channel avatar + handle + Subscribe pill. */
export function PlatformCard_YouTube() {
  return (
    <div
      className="relative w-[200px] h-[350px] bg-white border-[1.5px] border-[var(--ink)] rounded-2xl overflow-hidden text-white"
      style={{
        boxShadow: "5px 5px 0 0 var(--ink)",
        fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
      }}
    >
      {/* Full-bleed gradient background. */}
      <div className="absolute inset-0">
        <PostMedia />
      </div>

      {/* Top: YouTube logo pill + "Shorts" label. */}
      <div
        className="absolute top-3 left-3 z-[2] flex items-center gap-1.5 text-[11px] font-bold"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
      >
        <span
          className="font-display font-extrabold text-[9px] px-1.5 py-0.5 rounded-sm tracking-tight"
          style={{ background: "#ff0000", color: "#ffffff" }}
        >
          YouTube
        </span>
        <span>Shorts</span>
      </div>

      {/* Right rail: thumbs-up, dislike, comment, share with counts. */}
      <div className="absolute right-2 bottom-20 z-[2] flex flex-col gap-3.5 items-center text-[10px] font-semibold">
        <div
          className="flex flex-col items-center gap-0.5"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
        >
          <svg className="w-[22px] h-[22px] fill-white" viewBox="0 0 24 24">
            <path d="M7 22V11l5-9 1 1v8h7l-2 11H7z" />
          </svg>
          <span>12K</span>
        </div>
        <div
          className="flex flex-col items-center gap-0.5"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
        >
          <svg
            className="w-[22px] h-[22px] fill-white"
            viewBox="0 0 24 24"
            transform="rotate(180)"
          >
            <path d="M7 22V11l5-9 1 1v8h7l-2 11H7z" />
          </svg>
          <span>Dislike</span>
        </div>
        <div
          className="flex flex-col items-center gap-0.5"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
        >
          <svg className="w-[22px] h-[22px] fill-white" viewBox="0 0 24 24">
            <path d="M21 12a8 8 0 1 1-15-4.2L4 4l3 1.5A8 8 0 0 1 21 12z" />
          </svg>
          <span>284</span>
        </div>
        <div
          className="flex flex-col items-center gap-0.5"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
        >
          <svg className="w-[22px] h-[22px] fill-white" viewBox="0 0 24 24">
            <path d="M3 12l18-8-7 18-3-8-8-2z" />
          </svg>
          <span>Share</span>
        </div>
      </div>

      {/* Bottom: channel avatar + handle + Subscribe pill. */}
      <div className="absolute left-2.5 bottom-3.5 right-12 z-[2] flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-full flex-shrink-0"
          style={{
            background: "linear-gradient(135deg,#ff5a36,#e88c5a)",
          }}
        />
        <div
          className="text-[11px] font-bold"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
        >
          @sharetopus
        </div>
        <div className="ml-auto bg-white text-black font-bold text-[10px] px-2 py-1 rounded-full">
          Subscribe
        </div>
      </div>
    </div>
  );
}
