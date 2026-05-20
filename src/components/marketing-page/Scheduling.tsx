import Link from "next/link";

/* Scheduling feature row. Text left, autoplaying demo video left card, in the
   same ink-bordered hard-shadow card style as Crossposting.

   Video: /public/scheduling.{webm,mp4}. webm first (smaller), mp4 fallback.
   autoplay+loop+muted+playsInline so it plays inline on mobile without sound. */

export default function Scheduling() {
  return (
    <section
      id="scheduling"
      className="py-16 md:py-24 px-4 md:px-8 max-w-6xl mx-auto"
      style={{
        fontFamily:
          "'DM Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <div className="container px-5 lg:px-4 mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[1.08fr_0.92fr] gap-10 lg:gap-20 items-center">
          {/* Video card (left on desktop, below text on mobile) */}
          <div className="order-2 lg:order-1 w-full flex items-center justify-center">
            <div
              className="relative w-full max-w-[560px] rounded-[24px] lg:rounded-[28px] border-[1.5px] border-[#1C1B18] bg-[#F3F4EF] p-2.5 sm:p-3"
              style={{ boxShadow: "6px 6px 0 0 #1C1B18" }}
            >
              <video
                className="block w-full rounded-[18px] lg:rounded-[20px] border-[1.5px] border-[#1C1B18]"
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                aria-label="Sharetopus scheduling demo"
              >
                <source src="/scheduling.webm" type="video/webm" />
                <source src="/scheduling.mp4" type="video/mp4" />
              </video>
            </div>
          </div>

          {/* Copy + CTAs */}
          <div className="order-1 lg:order-2 max-w-xl">
            <div className="inline-flex items-center gap-2 mb-5">
              <span className="inline-block w-[7px] h-[7px] rounded-full bg-[#FF5A36]" />
              <span className="text-[12px] font-semibold tracking-[0.18em] uppercase text-[#FF5A36]">
                Scheduling
              </span>
            </div>

            <h2 className="text-[34px] leading-[1.04] sm:text-[40px] lg:text-[56px] font-extrabold tracking-[-0.035em] text-[#1C1B18] mb-5 lg:mb-6">
              Schedule posts{" "}
              <span className="italic text-[#FF5A36]">effortlessly.</span>
            </h2>

            <p className="text-[16px] sm:text-[17px] lg:text-[18px] leading-[1.55] text-[#4A4845] mb-7 lg:mb-8 max-w-[460px]">
              Plan your content ahead of time and schedule across every platform
              at once. Tailor each post per platform, queue them up, and let
              Sharetopus handle the rest.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/create"
                className="group inline-flex items-center justify-center gap-1.5 rounded-full bg-[#FF5A36] px-7 py-[14px] text-[15px] font-medium text-white shadow-[0_4px_14px_rgba(255,90,54,0.3)] transition-all hover:bg-[#E84A26] hover:shadow-[0_6px_18px_rgba(255,90,54,0.4)]"
              >
                <span>Start scheduling</span>
                <span className="inline-block transition-transform group-hover:translate-x-[3px]">
                  →
                </span>
              </Link>
              <Link
                href="/create"
                className="inline-flex items-center justify-center gap-2 rounded-full border-[1.5px] border-[#D6D5CF] bg-transparent px-7 py-[14px] text-[15px] font-medium text-[#1C1B18] transition-all hover:border-[#1C1B18] hover:bg-[#1C1B18] hover:text-[#F3F4EF]"
              >
                <span>See pricing</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
