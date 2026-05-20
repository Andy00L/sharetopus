/* StatsBand — sober, editorial version.
   Hairline dividers above/below + between columns. No card chrome,
   no shadows, no orange numerals. Reads as a quiet masthead row that
   sits between two louder sections.
*/
const STATS = [
  { value: "4", label: "Social platforms supported" },
  { value: "1,265,120", label: "Posts published by users" },
  { value: "2 min", label: "Average time to post everywhere" },
];
export default function StatsBand() {
  return (
    <section
      className="py-14 lg:py-20"
      style={{
        background: "#F3F4EF",
        fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
      }}
    >
      <div className="container px-5 lg:px-4 mx-auto max-w-[1180px]">
        {/* top hairline */}
        <div className="h-px w-full" style={{ background: "#D6D5CF" }} />
        <div className="grid grid-cols-1 md:grid-cols-3">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="py-8 md:py-10 md:px-8 first:md:pl-0 last:md:pr-0 border-b border-[#D6D5CF] last:border-b-0 md:border-b-0 md:border-l md:first:border-l-0"
            >
              <div
                className="leading-[0.95] text-[#1C1B18] mb-3"
                style={{
                  fontWeight: 600,
                  letterSpacing: "-0.045em",
                  fontSize: "clamp(40px, 6.2vw, 64px)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.value}
              </div>
              <div
                className="text-[11px] font-semibold uppercase text-[#8A857A]"
                style={{ letterSpacing: "0.18em" }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
        {/* bottom hairline */}
        <div className="h-px w-full" style={{ background: "#D6D5CF" }} />
      </div>
    </section>
  );
}
