import { PostMedia } from "../PostMedia";

/* LinkedIn mockup card.
   Header: gradient avatar + name + LinkedIn "in" badge + title + meta.
   Body: longer professional text.
   Image: gradient post.
   Footer: thumbs-up bubble + reactions count. */
export function PlatformCard_LinkedIn() {
  return (
    <div
      className="relative w-[200px] h-[350px] bg-white border-[1.5px] border-[var(--ink)] rounded-2xl overflow-hidden p-3"
      style={{
        boxShadow: "5px 5px 0 0 var(--ink)",
        fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
        color: "#000",
      }}
    >
      {/* Header: avatar + name with LinkedIn badge + title + meta. */}
      <div className="flex gap-2">
        <div
          className="w-9 h-9 rounded-full flex-shrink-0"
          style={{
            background: "linear-gradient(135deg,#ff5a36,#e88c5a)",
          }}
        />
        <div className="flex-1 leading-tight">
          <div className="font-bold text-[12px] flex items-center gap-1">
            Sharetopus
            <span
              className="font-display font-extrabold text-[8px] text-white px-[3px] py-[1px] rounded-sm"
              style={{ background: "#0a66c2" }}
            >
              in
            </span>
          </div>
          <div className="text-[#00000099] text-[10px]">
            Building cross-posting for indie creators
          </div>
          <div className="text-[#00000099] text-[10px]">2d · 🌐</div>
        </div>
      </div>

      {/* Post body text. */}
      <div className="text-[11px] leading-snug my-2">
        We&apos;ve made cross-posting fairer. One composer, 8 networks, from $9
        to $27/mo.
      </div>

      {/* Media area: gradient PostMedia. */}
      <div className="h-[110px] rounded overflow-hidden">
        <PostMedia />
      </div>

      {/* Footer: reaction bubble + counts. */}
      <div className="flex gap-1.5 items-center mt-2 text-[10px] text-[#00000099]">
        <div
          className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-white text-[8px]"
          style={{ background: "#378fe9" }}
        >
          👍
        </div>
        <span>487 · 32 comments</span>
      </div>
    </div>
  );
}
