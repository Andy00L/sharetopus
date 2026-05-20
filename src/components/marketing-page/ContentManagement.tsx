import Link from "next/link";

/* ContentManagement — restyled to match the Sharetopus landing system:
   - Cream surface w/ ink (#1C1B18) border + 6px hard offset shadow
   - Orange accent (#FF5A36) eyebrow + italic display accent on the headline
   - Layout: copy LEFT, media RIGHT on desktop
   Video: /public/manage.{webm,mp4}, webm first, autoplay+muted+loop+playsInline. */

export default function ContentManagement() {
  return (
    <section
      className="py-16 md:py-24 px-4 md:px-8 max-w-6xl mx-auto"
      style={{
        fontFamily:
          "'DM Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <div className="container px-5 lg:px-4 mx-auto max-w-[1180px]">
        <div className="grid grid-cols-1 lg:grid-cols-[0.92fr_1.08fr] gap-10 lg:gap-20 items-center">
          {/* ── Copy + CTAs (left on desktop) ────────────────────────── */}
          <div className="max-w-xl">
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 mb-5">
              <span className="inline-block w-[7px] h-[7px] rounded-full bg-[#FF5A36]" />
              <span className="text-[12px] font-semibold tracking-[0.18em] uppercase text-[#FF5A36]">
                Content management
              </span>
            </div>

            <h2 className="text-[34px] leading-[1.04] sm:text-[40px] lg:text-[56px] font-extrabold tracking-[-0.035em] text-[#1C1B18] mb-5 lg:mb-6">
              Manage content{" "}
              <span className="italic text-[#FF5A36]">efficiently.</span>
            </h2>

            <p className="text-[16px] sm:text-[17px] lg:text-[18px] leading-[1.55] text-[#4A4845] mb-7 lg:mb-8 max-w-[460px]">
              See every scheduled and published post in one place. Track what
              shipped, tweak what&apos;s next, and never lose sight of the
              bigger content picture.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/create"
                className="group inline-flex items-center justify-center gap-1.5 rounded-full bg-[#FF5A36] px-7 py-[14px] text-[15px] font-medium text-white shadow-[0_4px_14px_rgba(255,90,54,0.3)] transition-all hover:bg-[#E84A26] hover:shadow-[0_6px_18px_rgba(255,90,54,0.4)]"
              >
                <span>Get started</span>
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

          {/* ── Media (right on desktop) ─────────────────────────────── */}
          <div className="w-full flex items-center justify-center">
            <div
              className="relative w-full max-w-[560px] rounded-[24px] lg:rounded-[28px] border-[1.5px] border-[#1C1B18] bg-[#F3F4EF] p-3 sm:p-5 lg:p-6"
              style={{ boxShadow: "6px 6px 0 0 #1C1B18" }}
            >
              <div
                className="rounded-[14px] sm:rounded-[18px] overflow-hidden border-[1.5px] border-[#1C1B18] bg-white"
                style={{ boxShadow: "3px 3px 0 0 #1C1B18" }}
              >
                <video
                  className="w-full block"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  aria-label="Sharetopus content management demo"
                >
                  <source src="/manage.webm" type="video/webm" />
                  <source src="/manage.mp4" type="video/mp4" />
                  Your browser doesn&apos;t support this video.
                </video>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
