import Image from "next/image";

/** Displayed card width in px. */
const CARD_WIDTH_PX = 135;

// Offsets in px from the fan's center.
type PerformanceCard = {
  src: string;
  translateX: number;
  translateY: number;
  rotateDeg: number;
  zIndex: number;
};

const PERFORMANCE_CARDS: PerformanceCard[] = [
  { src: "/performance/70m_views.png", translateX: -210, translateY: -42, rotateDeg: -7, zIndex: 0 },
  { src: "/performance/16m_views.png", translateX: -158, translateY: 52, rotateDeg: 4, zIndex: 1 },
  { src: "/performance/5m_views.png", translateX: -108, translateY: -28, rotateDeg: -3, zIndex: 2 },
  { src: "/performance/132k_followers.png", translateX: -55, translateY: 60, rotateDeg: 6, zIndex: 3 },
  { src: "/performance/5m_views2.png", translateX: 0, translateY: -52, rotateDeg: -5, zIndex: 4 },
  { src: "/performance/18k_followers.png", translateX: 55, translateY: 45, rotateDeg: 8, zIndex: 5 },
  { src: "/performance/5394_followers.png", translateX: 108, translateY: -38, rotateDeg: -2, zIndex: 6 },
  { src: "/performance/5m_views3.png", translateX: 158, translateY: 56, rotateDeg: 5, zIndex: 7 },
  { src: "/performance/4800_followers.png", translateX: 210, translateY: -22, rotateDeg: -8, zIndex: 8 },
  { src: "/performance/219k_views.png", translateX: -185, translateY: 10, rotateDeg: 3, zIndex: 9 },
  { src: "/performance/118k_views.png", translateX: -132, translateY: 66, rotateDeg: -6, zIndex: 10 },
  { src: "/performance/374k_views.png", translateX: -80, translateY: -60, rotateDeg: 7, zIndex: 11 },
  { src: "/performance/207k_views.png", translateX: -28, translateY: 38, rotateDeg: -4, zIndex: 12 },
  { src: "/performance/671k_views.png", translateX: 28, translateY: -66, rotateDeg: 2, zIndex: 13 },
  { src: "/performance/522k_views.png", translateX: 80, translateY: 64, rotateDeg: -9, zIndex: 14 },
  { src: "/performance/1688_followers.png", translateX: 185, translateY: -56, rotateDeg: 6, zIndex: 15 },
];

const RESULT_BULLETS = [
  "Same post, every account, fired automatically",
  "Views that stack instead of plateauing",
  "Millions in reach without posting by hand",
];

/**
 * Results row: copy on the left, a fan of 16 creator-result cards on the right.
 * Images skip the optimizer (unoptimized): its URLs for these PNGs returned 404.
 */
export default function Results() {
  return (
    <section
      id="results"
      className="py-16 md:py-24 px-4 md:px-8 max-w-6xl mx-auto"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
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
            {RESULT_BULLETS.map((bullet) => (
              <li key={bullet} className="t-body flex items-start gap-3">
                <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-primary" />
                {bullet}
              </li>
            ))}
          </ul>
        </div>

        <div className="order-1 lg:order-2 relative flex items-center justify-center min-h-[300px] lg:min-h-[360px] overflow-visible">
          <div className="relative h-[200px] w-[420px] scale-[0.55] sm:scale-75 lg:scale-90">
            {PERFORMANCE_CARDS.map((card) => (
              <Image
                key={card.src}
                src={card.src}
                alt=""
                unoptimized
                loading="lazy"
                draggable={false}
                width={CARD_WIDTH_PX}
                height={CARD_WIDTH_PX}
                className="absolute left-1/2 top-1/2 h-auto rounded-xl select-none pointer-events-none"
                style={{
                  width: CARD_WIDTH_PX,
                  transform: `translate(-50%, -50%) translate(${card.translateX}px, ${card.translateY}px) rotate(${card.rotateDeg}deg)`,
                  zIndex: card.zIndex,
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
