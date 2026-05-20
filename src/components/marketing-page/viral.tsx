/* Results feature row. Single column until lg, two columns at lg+ (text left,
   proof fan right). Fan = 16 creator-result cards spread with scaled-out
   translate/rotate values, centered on a real-sized anchor.

   Plain <img> on purpose: tiny static PNGs in /public; next/image produced
   broken /_next/image optimizer URLs that 404'd. */

const CARD_W = 135; // px — displayed card width

type PerfCard = { src: string; x: number; y: number; r: number; z: number };

const PERFORMANCE_CARDS: PerfCard[] = [
  { src: "/performance/70m_views.png", x: -210, y: -42, r: -7, z: 0 },
  { src: "/performance/16m_views.png", x: -158, y: 52, r: 4, z: 1 },
  { src: "/performance/5m_views.png", x: -108, y: -28, r: -3, z: 2 },
  { src: "/performance/132k_followers.png", x: -55, y: 60, r: 6, z: 3 },
  { src: "/performance/5m_views2.png", x: 0, y: -52, r: -5, z: 4 },
  { src: "/performance/18k_followers.png", x: 55, y: 45, r: 8, z: 5 },
  { src: "/performance/5394_followers.png", x: 108, y: -38, r: -2, z: 6 },
  { src: "/performance/5m_views3.png", x: 158, y: 56, r: 5, z: 7 },
  { src: "/performance/4800_followers.png", x: 210, y: -22, r: -8, z: 8 },
  { src: "/performance/219k_views.png", x: -185, y: 10, r: 3, z: 9 },
  { src: "/performance/118k_views.png", x: -132, y: 66, r: -6, z: 10 },
  { src: "/performance/374k_views.png", x: -80, y: -60, r: 7, z: 11 },
  { src: "/performance/207k_views.png", x: -28, y: 38, r: -4, z: 12 },
  { src: "/performance/671k_views.png", x: 28, y: -66, r: 2, z: 13 },
  { src: "/performance/522k_views.png", x: 80, y: 64, r: -9, z: 14 },
  { src: "/performance/1688_followers.png", x: 185, y: -56, r: 6, z: 15 },
];

export default function Results() {
  return (
    <section
      id="results"
      className="py-16 md:py-24 px-4 md:px-8 max-w-6xl mx-auto"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        {/* Copy + bullets */}
        <div className="order-2 lg:order-1">
          <div className="t-eyebrow mb-3">
            <span className="inline-block size-1.5 rounded-full bg-primary mr-2 align-middle" />
            The Compounding Effect
          </div>
          <h2 className="t-section-h2 mb-5">
            Don&apos;t get stuck.{" "}
            <span className="t-section-accent">Stack the views.</span>
          </h2>
          <p className="t-body max-w-md mb-7">
            One account plateaus. The same content, posted consistently across
            all of them, compounds, and the views stack into the millions. One
            upload, every account, on schedule.
          </p>
          <ul className="flex flex-col gap-3">
            {[
              "Same post, every account, fired automatically",
              "Views that stack instead of plateauing",
              "Millions in reach without posting by hand",
            ].map((b) => (
              <li key={b} className="t-body flex items-start gap-3">
                <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-primary" />
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* Proof fan. Each card absolutely centered on the container's midpoint,
               then offset by its transform. Rounded + soft shadow. */}
        <div className="order-1 lg:order-2 relative flex items-center justify-center min-h-[300px] lg:min-h-[360px] overflow-visible">
          <div className="relative h-[200px] w-[420px] scale-[0.55] sm:scale-75 lg:scale-90">
            {PERFORMANCE_CARDS.map((c) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={c.src}
                src={c.src}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                width={CARD_W}
                className="absolute left-1/2 top-1/2 h-auto rounded-xl select-none pointer-events-none"
                style={{
                  width: CARD_W,
                  transform: `translate(-50%, -50%) translate(${c.x}px, ${c.y}px) rotate(${c.r}deg)`,
                  zIndex: c.z,
                  boxShadow: "0 10px 30px -12px rgba(28,27,24,0.35)",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
