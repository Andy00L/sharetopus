import { PostMedia } from "../PostMedia";
import { Octopus } from "../../../icons/octopus";

/* X (Twitter) mockup card.
   Header: gradient avatar with embedded Octopus + handle + verified + timestamp + X wordmark.
   Body: short text post.
   Embed: bordered media frame.
   Footer: reply/retweet/like/share counts. */
export function PlatformCard_X() {
  return (
    <div
      className="relative w-[200px] h-[350px] bg-white border-[1.5px] border-[var(--ink)] rounded-2xl overflow-hidden p-3"
      style={{
        boxShadow: "5px 5px 0 0 var(--ink)",
        fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
        color: "#0f1419",
      }}
    >
      {/* Header: avatar + name/handle + X wordmark. */}
      <div className="flex gap-2 items-start">
        <div
          className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg,#ff5a36,#e88c5a)",
          }}
        >
          <Octopus size={18} color="#ffffff" />
        </div>
        <div className="flex-1 text-[11px] leading-tight">
          <div className="font-bold text-[#0f1419] flex items-center gap-1">
            Sharetopus <span style={{ color: "#1d9bf0" }}>✓</span>
          </div>
          <div className="text-[#536471] text-[10px]">@sharetopus · 2h</div>
        </div>
        <div className="font-display font-extrabold text-[16px]">𝕏</div>
      </div>

      {/* Post body text. */}
      <div className="text-[12px] leading-snug my-2">
        one post to 8 platforms in 30 seconds. by <b>@sharetopus</b>
      </div>

      {/* Embedded media frame. */}
      <div className="border border-[#cfd9de] rounded-xl h-[130px] overflow-hidden">
        <PostMedia />
      </div>

      {/* Footer: engagement counts. */}
      <div className="flex justify-between mt-2.5 text-[10px] text-[#536471]">
        <span>💬 84</span>
        <span>⟲ 412</span>
        <span>♡ 1.2K</span>
        <span>↗</span>
      </div>
    </div>
  );
}
