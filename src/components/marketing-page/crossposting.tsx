import Link from "next/link";

/* Cross-posting hub-and-spoke. Icon and spoke Y positions share RIGHT_Y so lines
   meet nodes. Plain <img> for platform SVGs; hub uses the transparent logo.
   #platforms lives on SupportedPlatforms (View platforms CTA scrolls there). */

const PLATFORMS = [
  { label: "Facebook", src: "/facebook.svg" },
  { label: "Instagram", src: "/instagram.svg" },
  { label: "Twitter", src: "/x.svg" },
  { label: "LinkedIn", src: "/linkedin.svg" },
  { label: "TikTok", src: "/tiktok.svg" },
];

const RIGHT_Y = [15, 30, 50, 70, 85];

const HUB = { x: 50, y: 50 };
const USER = { x: 15, y: 50 };
const PLATFORM_X = 85;

const LINE_ANIM_CSS = `
@keyframes travelLineLeft {
  0% { stroke-dashoffset: 300; opacity: 1; }
  30% { stroke-dashoffset: -300; opacity: 1; }
  30.01% { opacity: 0; }
  100% { stroke-dashoffset: 300; opacity: 0; }
}
@keyframes travelLineRight {
  0% { stroke-dashoffset: 400; opacity: 1; }
  40% { stroke-dashoffset: -400; opacity: 1; }
  40.01% { opacity: 0; }
  100% { stroke-dashoffset: 400; opacity: 0; }
}
.animated-line-left { stroke-dasharray: 80 1000; animation: travelLineLeft 3s linear infinite; }
.animated-line-right { stroke-dasharray: 80 1000; animation: travelLineRight 3s linear 0.2s infinite; }
@media (prefers-reduced-motion: reduce) {
  .animated-line-left, .animated-line-right { animation: none; opacity: 0; }
}
`;

export default function Crossposting() {
  return (
    <section
      className="py-16 md:py-24 px-4 md:px-8 max-w-6xl mx-auto"
      style={{
        fontFamily:
          "'DM Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <div className="container px-4 mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[0.92fr_1.08fr] gap-12 lg:gap-20 items-center">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 mb-5">
              <span className="inline-block w-[7px] h-[7px] rounded-full bg-[#FF5A36]" />
              <span className="text-[12px] font-semibold tracking-[0.18em] uppercase text-[#FF5A36]">
                Cross-posting
              </span>
            </div>

            <h2 className="text-[40px] leading-[1.02] lg:text-[56px] font-extrabold tracking-[-0.035em] text-[#1C1B18] mb-6">
              Post to all platforms{" "}
              <span className="italic text-[#FF5A36]">instantly.</span>
            </h2>

            <p className="text-[17px] lg:text-[18px] leading-[1.55] text-[#4A4845] mb-8 max-w-[460px]">
              Publish everywhere in 30 seconds, not 30 minutes. Manage personal
              and brand accounts without switching tabs. One composer, every
              network.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/create"
                className="group inline-flex items-center justify-center gap-1.5 rounded-full bg-[#FF5A36] px-7 py-[14px] text-[15px] font-medium text-white shadow-[0_4px_14px_rgba(255,90,54,0.3)] transition-all hover:bg-[#E84A26] hover:shadow-[0_6px_18px_rgba(255,90,54,0.4)]"
              >
                <span>Start posting</span>
                <span className="inline-block transition-transform group-hover:translate-x-[3px]">
                  →
                </span>
              </Link>
              <Link
                href="#platforms"
                className="inline-flex items-center justify-center gap-2 rounded-full border-[1.5px] border-[#D6D5CF] bg-transparent px-7 py-[14px] text-[15px] font-medium text-[#1C1B18] transition-all hover:border-[#1C1B18] hover:bg-[#1C1B18] hover:text-[#F3F4EF]"
              >
                <span>View platforms</span>
              </Link>
            </div>
          </div>

          <div className="w-full flex items-center justify-center">
            <div
              className="relative w-full max-w-[560px] rounded-[28px] border-[1.5px] border-[#1C1B18] bg-[#F3F4EF] p-8"
              style={{ boxShadow: "6px 6px 0 0 #1C1B18" }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-[28px] opacity-[0.35]"
                style={{
                  backgroundImage:
                    "radial-gradient(#1C1B18 0.6px, transparent 0.6px)",
                  backgroundSize: "14px 14px",
                  maskImage:
                    "radial-gradient(ellipse at center, black 40%, transparent 75%)",
                }}
              />

              <div
                className="relative w-full h-[420px]"
                role="img"
                aria-label="Cross-posting flow: one user, through the Sharetopus hub, out to Facebook, Instagram, X, LinkedIn, and TikTok"
              >
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{ zIndex: 1 }}
                >
                  <defs>
                    <style
                      dangerouslySetInnerHTML={{ __html: LINE_ANIM_CSS }}
                    />
                  </defs>

                  <line
                    x1={USER.x}
                    y1={USER.y}
                    x2={HUB.x}
                    y2={HUB.y}
                    stroke="#C8C2B1"
                    strokeWidth={1.4}
                    vectorEffect="non-scaling-stroke"
                  />
                  {RIGHT_Y.map((y) => (
                    <line
                      key={`base-${y}`}
                      x1={HUB.x}
                      y1={HUB.y}
                      x2={PLATFORM_X}
                      y2={y}
                      stroke="#C8C2B1"
                      strokeWidth={1.6}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}

                  <line
                    x1={USER.x}
                    y1={USER.y}
                    x2={HUB.x}
                    y2={HUB.y}
                    stroke="#FF5A36"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    className="animated-line-left"
                  />
                  {RIGHT_Y.map((y) => (
                    <line
                      key={`pulse-${y}`}
                      x1={HUB.x}
                      y1={HUB.y}
                      x2={PLATFORM_X}
                      y2={y}
                      stroke="#FF5A36"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      className="animated-line-right"
                    />
                  ))}
                </svg>

                <div
                  className="absolute group"
                  style={{
                    left: `${USER.x}%`,
                    top: `${USER.y}%`,
                    transform: "translate(-50%, -50%)",
                    zIndex: 10,
                  }}
                >
                  <div
                    className="flex size-[68px] items-center justify-center rounded-full border-[1.5px] border-[#1C1B18] bg-white transition-transform duration-300 group-hover:scale-[1.06]"
                    style={{ boxShadow: "3px 3px 0 0 #1C1B18" }}
                  >
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#1C1B18"
                      strokeWidth={1.7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <circle cx="12" cy="8" r="3.5" />
                      <path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" />
                    </svg>
                  </div>
                </div>

                <div
                  className="absolute group"
                  style={{
                    left: `${HUB.x}%`,
                    top: `${HUB.y}%`,
                    transform: "translate(-50%, -50%)",
                    zIndex: 20,
                  }}
                >
                  <div
                    className="flex size-[84px] items-center justify-center rounded-full border-[1.5px] border-[#1C1B18] bg-white overflow-hidden transition-transform duration-300 group-hover:scale-[1.06]"
                    style={{ boxShadow: "4px 4px 0 0 #1C1B18" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/trans_logo%20(1).webp"
                      alt="Sharetopus"
                      width={52}
                      height={52}
                      loading="lazy"
                      decoding="async"
                      className="w-[52px] h-[52px] object-contain"
                    />
                  </div>
                </div>

                {PLATFORMS.map((p, i) => (
                  <div
                    key={p.label}
                    className="group absolute"
                    style={{
                      left: `${PLATFORM_X}%`,
                      top: `${RIGHT_Y[i]}%`,
                      transform: "translate(-50%, -50%)",
                      zIndex: 10,
                    }}
                    title={p.label}
                  >
                    <div
                      className="flex size-[58px] items-center justify-center rounded-full border-[1.5px] border-[#1C1B18] bg-white transition-transform duration-300 hover:scale-[1.08] cursor-pointer"
                      style={{ boxShadow: "3px 3px 0 0 #1C1B18" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.src}
                        alt={p.label}
                        width={24}
                        height={24}
                        loading="lazy"
                        decoding="async"
                        className="w-6 h-6 transition-transform duration-300 group-hover:scale-110"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
