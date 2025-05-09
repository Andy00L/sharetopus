"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

// Define the type for confetti particles
interface ConfettiParticle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  rotation: number;
  speed: number;
}

const SimplePaymentSuccess = () => {
  // Properly type the state
  const [confetti, setConfetti] = useState<ConfettiParticle[]>([]);

  // Confetti animation
  useEffect(() => {
    // Create confetti particles
    const colors = [
      "#FF5252",
      "#FFD740",
      "#64FFDA",
      "#448AFF",
      "#E040FB",
      "#69F0AE",
    ];
    const newConfetti: ConfettiParticle[] = [];

    for (let i = 0; i < 150; i++) {
      newConfetti.push({
        id: i,
        x: Math.random() * 100,
        y: -20 - Math.random() * 100,
        size: 5 + Math.random() * 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        speed: 2 + Math.random() * 6,
      });
    }

    setConfetti(newConfetti);

    // Clean up animation after 6 seconds
    const timer = setTimeout(() => {
      setConfetti([]);
    }, 6000);

    return () => clearTimeout(timer);
  }, []);

  // Animation frame to update confetti positions
  useEffect(() => {
    if (confetti.length === 0) return;

    const animationFrame = requestAnimationFrame(() => {
      setConfetti(
        (prevConfetti) =>
          prevConfetti
            .map((particle) => {
              if (particle.y > 120) return null;

              return {
                ...particle,
                y: particle.y + particle.speed / 4,
                rotation: particle.rotation + 2,
              };
            })
            .filter(Boolean) as ConfettiParticle[]
      );
    });

    return () => cancelAnimationFrame(animationFrame);
  }, [confetti]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      {/* Confetti animation */}
      {confetti.map((particle) => (
        <div
          key={particle.id}
          className="fixed"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            backgroundColor: particle.color,
            borderRadius: "2px",
            transform: `rotate(${particle.rotation}deg)`,
            zIndex: 10,
            opacity: 0.8,
            transition: "transform 0.1s linear",
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
};

export default SimplePaymentSuccess;
