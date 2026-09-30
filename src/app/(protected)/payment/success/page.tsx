import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";

const CONFETTI_COLORS = [
  "#FF5252",
  "#FFD740",
  "#64FFDA",
  "#448AFF",
  "#E040FB",
  "#69F0AE",
];

/** Number of confetti pieces dropped once when the page opens. */
const CONFETTI_PARTICLE_COUNT = 150;

/**
 * Deterministic value in [0, 1) for a particle index and a salt, rounded to
 * 4 decimals. Seeded instead of Math.random so the server render and the
 * client hydration produce identical particles.
 */
function seededFraction(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return Math.round((value - Math.floor(value)) * 10_000) / 10_000;
}

/**
 * Computed once at module load. The fall and the spin run in CSS
 * (confetti-fall and confetti-spin in globals.css), so nothing re-renders
 * while the pieces move.
 */
const CONFETTI_PARTICLES = Array.from(
  { length: CONFETTI_PARTICLE_COUNT },
  (_emptySlot, index) => {
    // 2 to 8 seconds to fall the keyframe's 240vh.
    const fallSeconds = 2 + seededFraction(index, 6) * 6;
    return {
      id: index,
      leftPercent: seededFraction(index, 1) * 100,
      topPercent: -20 - seededFraction(index, 2) * 100,
      sizePx: 5 + seededFraction(index, 3) * 10,
      color:
        CONFETTI_COLORS[
          Math.floor(seededFraction(index, 4) * CONFETTI_COLORS.length)
        ],
      rotationDeg: seededFraction(index, 5) * 360,
      fallSeconds,
      // One turn per 3 seconds; stop once the piece has left the screen.
      spinTurns: Math.ceil(fallSeconds / 3),
    };
  },
);

export default function SimplePaymentSuccess() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 px-4 py-6">
      {CONFETTI_PARTICLES.map((particle) => (
        <div
          key={particle.id}
          aria-hidden="true"
          className="pointer-events-none fixed motion-reduce:hidden"
          style={{
            left: `${particle.leftPercent}%`,
            top: `${particle.topPercent}%`,
            width: `${particle.sizePx}px`,
            height: `${particle.sizePx}px`,
            backgroundColor: particle.color,
            borderRadius: "2px",
            transform: `rotate(${particle.rotationDeg}deg)`,
            zIndex: 10,
            opacity: 0.8,
            animation: `confetti-fall ${particle.fallSeconds}s linear forwards, confetti-spin 3s linear ${particle.spinTurns}`,
          }}
        />
      ))}

      <Card className="w-full max-w-md mx-auto shadow-lg p-4 text-center">
        <CardContent className="pt-6 px-8">
          <div className="h-24 w-24 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <Check className="h-12 w-12 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold mb-6">Payment Successful!</h1>
          <Link href={"/create"}>
            <Button className="w-full bg-blue-600 hover:bg-blue-700 py-6">
              Continue
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
