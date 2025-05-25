/* app/components/AlternativesSection.tsx */
"use client";

/* ---------- domain types ---------- */
interface Feature {
  readonly label: string;
  readonly positive: boolean;
}

interface AlternativeCard {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly features: ReadonlyArray<Feature>;
  readonly bg: string; // e.g. "bg-[#FF4A20] bg-opacity-10"
  readonly border: string; // e.g. "border-[#FF4A20] border-opacity-30"
}

/* ---------- data ---------- */
const cards: ReadonlyArray<AlternativeCard> = [
  {
    id: "competitor",
    title: "Competitor",
    description:
      "Expensive, charging $60-$120 per month, going upwards of $500 to $1000 a month for multiple  accounts.",
    bg: "bg-[#FF4A20]/20 bg-opacity-10",
    border: "border-[#FF4A20] border-opacity-30",
    features: [
      { label: "High cost", positive: false },
      { label: "Limited control", positive: false },
      { label: "Analatics", positive: true },
    ],
  },
  {
    id: "diy",
    title: "DIY Approach",
    description:
      "Time-consuming process: plan, change/manage account, schedule, iterate, re-purpose...",
    bg: "bg-[#FF4A20]/20 ",
    border: "border-[#FF4A20]  bg-opacity-90 border-opacity-30",
    features: [
      { label: "Time intensive", positive: false },
      { label: "Requires expertise", positive: false },
      { label: "Full creative control", positive: true },
    ],
  },
  {
    id: "Shartopus",
    title: "Shartopus",
    description:
      "Automatically schedule & publishe videos to all platforms for a simple monthly subscription.",
    bg: "bg-green-500/20 bg-opacity-10",
    border: "border-green-500 border-opacity-30",
    features: [
      { label: "Cost effective", positive: true },
      { label: "Fully automated", positive: true },
      { label: "Multi-platform publishing", positive: true },
    ],
  },
];

/* ---------- utility ---------- */
function FeatureLine({ feature }: { readonly feature: Feature }) {
  const icon = feature.positive ? "✓" : "✕";
  const iconColor = feature.positive ? "text-green-500" : "text-red-500";
  return (
    <div className="mt-1 flex items-center">
      <span className={`${iconColor} mr-2`}>{icon}</span>
      <span className="text-sm text-[#777]">{feature.label}</span>
    </div>
  );
}

/* ---------- card ---------- */
function AlternativeCardComponent({
  card,
}: {
  readonly card: AlternativeCard;
}) {
  return (
    <div
      className={`p-4 ${card.bg} muted border ${card.border}   flex flex-col text-left rounded-[16px] shadow`}
    >
      <p className="text-sm font-semibold text-[#191919] mb-2">{card.title}</p>
      <p className="text-sm text-[#777]">{card.description}</p>

      {/* features */}
      <div className="mt-3">
        {card.features.map((f) => (
          <FeatureLine key={f.label} feature={f} />
        ))}
      </div>
    </div>
  );
}

/* ---------- main section ---------- */
export default function AlternativesSection() {
  return (
    <section
      id="product"
      className="w-full max-w-[900px] text-left mt-8 mx-auto"
    >
      <h4 className="text-lg text-[#191919] font-semibold">
        Alternatives are expensive.
      </h4>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
        {cards.map((card) => (
          <AlternativeCardComponent key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}
