import Image from "next/image";
import Link from "next/link";
import { default as user1, default as user2 } from "../../../public/logo.png";

export default function Hero() {
  return (
    <section className="w-full flex justify-center py-5 ">
      <div className="container mx-auto ">
        <div className="max-w-3xl mx-auto text-center text-sm">
          <div className="inline-block px-3 mb-6 rounded-full bg-primary/10 text-primary  font-medium ">
            Find your perfect credit card
          </div>

          <h1 className="text-5xl grid md:text-6xl font-display font-bold leading-tight tracking-tight mb-6 ">
            <span className="inline-block">Discover the</span>{" "}
            <span className="inline-block text-green-600">
              Best Credit Cards
            </span>{" "}
            <span className="inline-block">in Canada</span>
          </h1>

          <p className="text-xl text-foreground/80 mb-8 leading-relaxed ">
            Find the perfect card for your lifestyle with our curated selection.
            Compare cashback, travel rewards, low fees, and more.
          </p>

          <div className="mt-10">
            <Link
              href="/dashboard"
              className="bg-[var(--primary)] text-[var(--primary-foreground)] px-6 py-3 rounded-md text-base font-medium hover:bg-[var(--primary)]/90"
            >
              Start exploring - it&apos;s free
            </Link>
          </div>

          <div className="mt-6 flex items-center justify-center">
            <div className="flex -space-x-2">
              <Image
                src={user1}
                alt="User"
                width={32}
                height={32}
                className="rounded-full border-2 border-[var(--background)]"
              />
              <Image
                src={user2}
                alt="User"
                width={32}
                height={32}
                className="rounded-full border-2 border-[var(--background)]"
              />
            </div>
            <span className="ml-3 text-sm text-[var(--muted-foreground)]">
              Loved by over 100,000 Canadians
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
