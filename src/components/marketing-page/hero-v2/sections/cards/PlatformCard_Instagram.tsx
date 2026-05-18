import { PostMedia } from "../PostMedia";

/* Instagram mockup card.
   Header: story-ring avatar + handle + 3-dots menu.
   Middle: square media area showing the gradient PostMedia.
   Bottom: action row, likes count, caption line with handle prefix
   and hashtags in IG-blue. */
export function PlatformCard_Instagram() {
  return (
    <div
      className="relative w-[200px] h-[350px] bg-white border-[1.5px] border-[var(--ink)] rounded-2xl overflow-hidden"
      style={{
        boxShadow: "5px 5px 0 0 var(--ink)",
        fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
      }}
    >
      {/* Header: story ring avatar + handle + menu dots. */}
      <div className="flex items-center gap-2 p-2.5 border-b border-[#efefef]">
        <div
          className="w-7 h-7 rounded-full p-0.5"
          style={{
            background:
              "conic-gradient(from 0deg, #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5, #feda75)",
          }}
        >
          <div className="w-full h-full rounded-full bg-white p-[1.5px]">
            <div
              className="w-full h-full rounded-full"
              style={{
                background: "linear-gradient(135deg,#ff5a36,#e88c5a)",
              }}
            />
          </div>
        </div>
        <div className="text-[12px] font-semibold text-black flex-1">
          sharetopus
        </div>
        <div className="text-black font-bold">···</div>
      </div>

      {/* Media area: 55% height, gradient PostMedia. */}
      <div className="w-full" style={{ height: "55%" }}>
        <PostMedia />
      </div>

      {/* Action row: heart, comment, share, bookmark. */}
      <div className="flex items-center px-2.5 pt-2 pb-1">
        <div className="flex gap-2.5 flex-1">
          <svg
            className="w-[22px] h-[22px] stroke-black fill-none"
            strokeWidth="1.6"
            viewBox="0 0 24 24"
          >
            <path d="M12 21s-7-4.5-9.5-9C.5 7.5 4 4 7 4c2 0 3.5 1.5 5 3 1.5-1.5 3-3 5-3 3 0 6.5 3.5 4.5 8-2.5 4.5-9.5 9-9.5 9z" />
          </svg>
          <svg
            className="w-[22px] h-[22px] stroke-black fill-none"
            strokeWidth="1.6"
            viewBox="0 0 24 24"
          >
            <path d="M21 12a8 8 0 1 1-15-4.2L4 4l3 1.5A8 8 0 0 1 21 12z" />
          </svg>
          <svg
            className="w-[22px] h-[22px] stroke-black fill-none"
            strokeWidth="1.6"
            viewBox="0 0 24 24"
          >
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </div>
        <svg
          className="w-[22px] h-[22px] stroke-black fill-none"
          strokeWidth="1.6"
          viewBox="0 0 24 24"
        >
          <path d="M19 21l-7-5-7 5V3h14v18z" />
        </svg>
      </div>

      {/* Likes count + caption with hashtags. */}
      <div className="px-2.5 text-[11px] font-bold text-black">
        2,148 likes
      </div>
      <div className="px-2.5 pt-0.5 text-[11px] text-black leading-tight">
        <span className="font-bold">sharetopus</span> we just made
        cross-posting fairer 🐙{" "}
        <span style={{ color: "#00376b" }}>#indie #saas</span>
      </div>
    </div>
  );
}
