import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  BarChart3,
  CalendarIcon,
  Clock,
  LockIcon,
} from "lucide-react";
import Link from "next/link";

export default function PremiumFeature() {
  return (
    <section
      className="py-12 bg-gradient-to-b from-background to-background/90 "
      id="premium"
    >
      <div className="container mx-auto px-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-block px-3 py-1 mb-6 rounded-full bg-primary/10 text-primary text-sm font-medium">
              Premium Features
            </div>

            <h2 className="text-3xl md:text-4xl font-display font-bold mb-6 leading-tight">
              Unlock Advanced Credit Management Tools
            </h2>

            <p className="text-lg text-foreground/80 mb-8 leading-relaxed">
              Our premium subscription gives you access to powerful tools that
              help you optimize your credit card usage, track application
              statuses, and maximize your rewards.
            </p>

            <div className="space-y-6 mb-8">
              <div className="flex">
                <div className="mr-4 h-10 w-10 flex items-center justify-center rounded-full bg-primary/10 text-primary">
                  <CalendarIcon size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-1">
                    Payment Reminders
                  </h3>
                  <p className="text-muted-foreground">
                    Never miss a payment with customized alerts and reminders
                  </p>
                </div>
              </div>

              <div className="flex">
                <div className="mr-4 h-10 w-10 flex items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Clock size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-1">
                    Application Timing
                  </h3>
                  <p className="text-muted-foreground">
                    Get recommendations on the ideal time to apply for new cards
                  </p>
                </div>
              </div>

              <div className="flex">
                <div className="mr-4 h-10 w-10 flex items-center justify-center rounded-full bg-primary/10 text-primary">
                  <BarChart3 size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-1">
                    Credit Analytics
                  </h3>
                  <p className="text-muted-foreground">
                    Track your credit limit, utilization, and approval odds
                  </p>
                </div>
              </div>
            </div>
            <Link href="app">
              <Button className="group">
                Get Premium Access
                <ArrowRight
                  size={16}
                  className="ml-2 transition-transform group-hover:translate-x-1"
                />
              </Button>
            </Link>
          </div>

          <div className="premium-card rounded-2xl p-8 border border-primary/20 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 bottom-0 w-1/2 bg-gradient-to-l from-primary/5 to-transparent" />

            <div className="relative z-10">
              <div className="flex justify-between items-start mb-8">
                <div className="p-4 rounded-xl bg-white/80 backdrop-blur shadow-sm border border-white/20">
                  <CalendarIcon size={32} className="text-primary" />
                </div>
                <div className="flex gap-1">
                  <div className="h-2 w-6 rounded-full bg-primary/30" />
                  <div className="h-2 w-10 rounded-full bg-primary/60" />
                  <div className="h-2 w-4 rounded-full bg-primary/90" />
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-lg p-4 bg-white/60 backdrop-blur border border-white/20">
                  <h4 className="font-semibold mb-2">
                    TD Aeroplan Visa Infinite
                  </h4>
                  <div className="flex justify-between text-sm">
                    <span>Next payment:</span>
                    <span className="font-medium">June 15, 2023</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Amount due:</span>
                    <span className="font-medium">$743.28</span>
                  </div>
                </div>

                <div className="rounded-lg p-4 bg-white/60 backdrop-blur border border-white/20">
                  <h4 className="font-semibold mb-2">
                    Optimal Application Window
                  </h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Based on your credit history and recent applications
                  </p>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full w-3/4 bg-primary rounded-full" />
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span>Too soon</span>
                    <span className="font-medium">Ideal time</span>
                    <span>Wait longer</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <div className="inline-flex items-center text-sm font-medium text-primary">
                  <LockIcon size={14} className="mr-1" /> Premium feature
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
