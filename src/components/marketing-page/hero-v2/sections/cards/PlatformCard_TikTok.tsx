import { PostMedia } from "../PostMedia";

/* TikTok mockup card.
   Vertical 9:16 frame. Top tabs (Following / For You).
   Right rail: heart / comment / share with counts.
   Bottom: caption with @handle and music attribution.
   Chrome sits on top of the gradient PostMedia with text-shadow for legibility. */
export function PlatformCard_TikTok() {
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

      {/* Top tabs: Following / For You. */}
      <div
        className="absolute top-3 left-0 right-0 flex justify-center gap-4 text-[11px] font-semibold z-[2]"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.2)" }}
      >
        <span className="opacity-65">Following</span>
        <span className="border-b-2 border-white pb-0.5">For You</span>
      </div>

      {/* Right rail: heart, comment, share with counts. */}
      <div className="absolute right-2 bottom-20 flex flex-col gap-3.5 items-center z-[2] text-[10px] font-semibold">
        <div
          className="flex flex-col items-center gap-0.5"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
        >
          <svg className="w-6 h-6 fill-white" viewBox="0 0 24 24">
            <path d="M12 21s-7-4.5-9.5-9C.5 7.5 4 4 7 4c2 0 3.5 1.5 5 3 1.5-1.5 3-3 5-3 3 0 6.5 3.5 4.5 8-2.5 4.5-9.5 9-9.5 9z" />
          </svg>
          <span>184K</span>
        </div>
        <div
          className="flex flex-col items-center gap-0.5"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
        >
          <svg className="w-6 h-6 fill-white" viewBox="0 0 24 24">
            <path
              d="M21 12a8 8 0 1 1-15-4.2L4 4l3 1.5A8 8 0 0 1 21 12z"
              fillOpacity=".9"
            />
          </svg>
          <span>2.1K</span>
        </div>
        <div
          className="flex flex-col items-center gap-0.5"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
        >
          <svg className="w-6 h-6 fill-white" viewBox="0 0 24 24">
            <path d="M3 12l18-8-7 18-3-8-8-2z" />
          </svg>
          <span>Share</span>
        </div>
      </div>

      {/* Bottom: caption, handle, music attribution. */}
      <div
        className="absolute left-2.5 bottom-2.5 right-12 z-[2] text-[10px] leading-tight"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}
      >
        <div className="font-bold text-[11px] mb-0.5">@sharetopus</div>
        <div className="opacity-95 mb-1.5">
          we just made cross-posting fairer 🐙
        </div>
        <div className="flex items-center gap-1 text-[9px] opacity-90">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="#fff">
            <path d="M9 18V6l12-2v12" />
          </svg>
          original sound, sharetopus
        </div>
      </div>
    </div>
  );
}
