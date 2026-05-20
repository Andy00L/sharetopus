import Link from "next/link";

/* SupportedPlatforms — Sharetopus landing system. Live integrations render as
   solid ink-bordered cards linking to /create; not-yet-supported networks are
   heavily blurred + tagged SOON. Section anchor: #platforms (navbar scrolls
   here). SVGs live at /public root. */

type Platform = { label: string; src: string; soon?: boolean };

const PLATFORMS: Platform[] = [
  { label: "LinkedIn", src: "/linkedin.svg" },
  { label: "TikTok", src: "/tiktok.svg" },
  { label: "YouTube", src: "/youtube.svg" },
  { label: "Pinterest", src: "/pinterest.svg" },
  { label: "Twitter/X", src: "/x.svg", soon: true },
  { label: "Instagram", src: "/instagram.svg", soon: true },
  { label: "Facebook", src: "/facebook.svg", soon: true },
  { label: "Bluesky", src: "/bluesky.svg", soon: true },
  { label: "Threads", src: "/threads.svg", soon: true },
  { label: "Google Business", src: "/google-business.svg", soon: true },
];

export default function SupportedPlatforms() {
  return (
    <section
      id="platforms"
      className="py-14 lg:py-24 scroll-mt-24"
      style={{
        background: "#F3F4EF",
        fontFamily:
          "'DM Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <div className="container px-5 lg:px-4 mx-auto max-w-[1180px]">
        {/* Section head */}
        <div className="text-center mb-10 lg:mb-14 max-w-[640px] mx-auto">
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="inline-block w-[7px] h-[7px] rounded-full bg-[#FF5A36]" />
            <span className="text-[12px] font-semibold tracking-[0.18em] uppercase text-[#FF5A36]">
              Platforms
            </span>
          </div>
          <h2 className="text-[34px] leading-[1.04] sm:text-[40px] lg:text-[52px] font-extrabold tracking-[-0.035em] text-[#1C1B18] mb-4">
            Every network{" "}
            <span className="italic text-[#FF5A36]">in one place.</span>
          </h2>
          <p className="text-[16px] sm:text-[17px] leading-[1.55] text-[#4A4845]">
            Four networks live today, six more rolling out soon. One composer,
            one schedule, every audience.
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 lg:gap-5">
          {PLATFORMS.map((p) =>
            p.soon ? (
              <div
                key={p.label}
                className="relative flex flex-col items-center text-center rounded-[16px] lg:rounded-[20px] border-[1.5px] border-dashed border-[#8A857A] bg-white/40 px-3 py-6 sm:py-7 cursor-not-allowed overflow-hidden"
                title={`${p.label} — coming soon`}
                aria-disabled
              >
                <div
                  className="relative w-14 h-14 sm:w-16 sm:h-16 mb-3"
                  style={{ filter: "blur(7px) saturate(0.5)", opacity: 0.5 }}
                  aria-hidden
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.src}
                    alt=""
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                </div>
                <h3
                  className="text-[13px] sm:text-[14px] font-semibold text-[#8A857A]"
                  style={{ letterSpacing: "-0.015em" }}
                >
                  {p.label}
                </h3>
                <span
                  className="absolute top-2.5 right-2.5 text-[8.5px] font-bold tracking-[0.14em] uppercase px-1.5 py-0.5 rounded-full"
                  style={{ background: "#1C1B18", color: "#fff" }}
                >
                  Soon
                </span>
              </div>
            ) : (
              <Link
                key={p.label}
                href="/create"
                className="group flex flex-col items-center text-center rounded-[16px] lg:rounded-[20px] border-[1.5px] border-[#1C1B18] bg-white px-3 py-6 sm:py-7 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-[4px_4px_0_0_#1C1B18]"
              >
                <div className="relative w-14 h-14 sm:w-16 sm:h-16 mb-3 transition-transform duration-300 group-hover:scale-110">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.src}
                    alt={p.label}
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                </div>
                <h3
                  className="text-[13px] sm:text-[14px] font-semibold text-[#1C1B18]"
                  style={{ letterSpacing: "-0.015em" }}
                >
                  {p.label}
                </h3>
              </Link>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
