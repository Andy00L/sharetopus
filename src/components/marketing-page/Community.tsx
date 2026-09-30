import Link from "next/link";

/* Dark Get-Started CTA band closing the landing page. */

export default function Community() {
  return (
    <section
      className="bg-[#1C1B18] text-[#F3F4EF] py-20 lg:py-24 text-center px-5"
      style={{
        fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
      }}
    >
      <div className="mx-auto max-w-[1180px]">
        <h2 className="text-[44px] leading-[1.05] sm:text-[60px] lg:text-[82px] font-extrabold tracking-[-0.04em] mb-5">
          Stop posting{" "}
          <span className="italic text-[#FF5A36]">eight times.</span>
        </h2>
        <p className="text-[17px] lg:text-[21px] text-[rgba(243,244,239,0.6)] mb-8">
          From $9/month. Cancel anytime.
        </p>
        <Link
          href="/create"
          className="group inline-flex items-center justify-center gap-1.5 rounded-full bg-[#FF5A36] px-8 py-4 text-[17px] font-medium text-white shadow-[0_4px_14px_rgba(255,90,54,0.3)] transition-all hover:bg-[#E84A26] hover:shadow-[0_6px_18px_rgba(255,90,54,0.4)]"
        >
          <span>Get Started</span>
          <span className="inline-block transition-transform group-hover:translate-x-[3px]">
            →
          </span>
        </Link>
      </div>
    </section>
  );
}
