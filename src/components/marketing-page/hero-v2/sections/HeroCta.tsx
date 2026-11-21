"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";

export function HeroCta() {
  const { userId } = useAuth();

  return (
    <Button
      asChild
      className="rounded-full bg-primary text-primary-foreground t-button-lg px-7 py-4 hover:bg-[var(--orange-2)] gap-1.5"
    >
      <Link href="/create">
        {userId ? "Get back" : "Get Started"} <span>→</span>
      </Link>
    </Button>
  );
}
