import { Button } from "@/components/ui/button";
import { ArrowRight, BarChart, Clock, Upload } from "lucide-react";
import Link from "next/link";

export default function Cta() {
  return (
    <section className="py-24 bg-gradient-to-br from-primary/5 to-primary/10">
      <div className="container px-4 mx-auto">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="mb-6 text-3xl font-bold tracking-tight md:text-4xl">
            Ready to streamline your social media workflow?
          </h2>
          <p className="max-w-2xl mx-auto mb-8 text-lg text-muted-foreground">
            Join thousands of content creators and social media managers who are
            saving hours every week with Sharetopus.
          </p>

          <div className="flex flex-wrap gap-4 justify-center mb-12">
            <div className="flex flex-col items-center px-6 py-4 rounded-lg bg-white shadow-sm border">
              <Clock size={24} className="text-primary mb-2" />
              <span className="text-3xl font-bold">8+</span>
              <span className="text-sm text-muted-foreground">
                Hours saved weekly
              </span>
            </div>
            <div className="flex flex-col items-center px-6 py-4 rounded-lg bg-white shadow-sm border">
              <BarChart size={24} className="text-primary mb-2" />
              <span className="text-3xl font-bold">35%</span>
              <span className="text-sm text-muted-foreground">
                Higher engagement
              </span>
            </div>
            <div className="flex flex-col items-center px-6 py-4 rounded-lg bg-white shadow-sm border">
              <Upload size={24} className="text-primary mb-2" />
              <span className="text-3xl font-bold">5x</span>
              <span className="text-sm text-muted-foreground">
                Faster publishing
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Button size="lg" className="px-8 py-6 text-lg group">
              <Link href="/create" className="flex items-center">
                Get Started For Free
                <ArrowRight
                  size={18}
                  className="ml-2 transition-transform group-hover:translate-x-1"
                />
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="px-8 py-6 text-lg">
              <Link href="#pricing">View Pricing</Link>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground flex justify-center items-center">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mr-2"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            No credit card required. 14-day free trial on all paid plans.
          </p>

          <div className="mt-12 p-6 bg-white rounded-lg border shadow-sm max-w-2xl mx-auto">
            <div className="flex items-start gap-4">
              <div className="mt-1 w-12 h-12 rounded-full bg-primary/10 flex-shrink-0 flex items-center justify-center">
                <span className="font-bold text-primary">JD</span>
              </div>
              <div className="text-left">
                <p className="italic text-foreground mb-4">
                  &quot;Sharetopus has completely transformed how I manage
                  content across my social platforms. I used to spend hours
                  uploading the same content individually to each platform. Now
                  I just upload once and distribute everywhere with a
                  click.&quot;
                </p>
                <div>
                  <p className="font-medium">Jamie Dawson</p>
                  <p className="text-sm text-muted-foreground">
                    Social Media Influencer with 500k+ followers
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
