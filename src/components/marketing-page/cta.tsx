import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function Cta() {
  return (
    <section className="py-16 bg-white md:py-24">
      <div className="container px-4 mx-auto text-center max-w-7xl">
        <h2 className="mb-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Ready to take control of your finances?
        </h2>
        <p className="max-w-2xl mx-auto mb-8 text-xl text-slate-600">
          Join thousands of users who&apos;ve improved their financial health
          with our platform.
        </p>{" "}
        <Button
          size="lg"
          className="px-8 py-6 text-lg text-white bg-slate-800 hover:bg-slate-700"
        >
          <Link href="/dashboard">Get Started For Free</Link>
        </Button>
        <p className="mt-4 text-sm text-slate-500">
          No credit card required. 14-day free trial.
        </p>
      </div>
    </section>
  );
}
