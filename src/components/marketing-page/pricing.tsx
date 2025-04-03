import { Check, X, ArrowRight, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function PricingSection() {
  return (
    <section
      className="py-12 bg-gradient-to-b from-background/90 to-background"
      id="pricing"
    >
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-block px-3 py-1 mb-6 rounded-full bg-primary/10 text-primary text-sm font-medium">
            Pricing
          </div>
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-4 leading-tight">
            Choose Your Plan
          </h2>
          <p className="text-lg text-foreground/70 max-w-2xl mx-auto">
            Get started for free or unlock all features with our premium plan to
            maximize your credit card experience.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Free Plan */}
          <Card className="relative flex flex-col border-border/40 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-8">
              <CardTitle className="text-2xl">Free Plan</CardTitle>
              <CardDescription className="mt-2">
                Essential features for credit card browsing
              </CardDescription>
              <div className="mt-4">
                <span className="text-4xl font-bold">$0</span>
                <span className="text-muted-foreground">/month</span>
              </div>
            </CardHeader>
            <CardContent className="flex-grow">
              <ul className="space-y-3">
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Browse all credit cards</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Filter by cash back, travel, and more</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Compare card features</span>
                </li>
                <li className="flex items-start">
                  <X
                    size={20}
                    className="mr-3 text-muted-foreground shrink-0 mt-0.5"
                  />
                  <span className="text-muted-foreground">
                    Payment reminders
                  </span>
                </li>
                <li className="flex items-start">
                  <X
                    size={20}
                    className="mr-3 text-muted-foreground shrink-0 mt-0.5"
                  />
                  <span className="text-muted-foreground">
                    Optimal application timing
                  </span>
                </li>
                <li className="flex items-start">
                  <X
                    size={20}
                    className="mr-3 text-muted-foreground shrink-0 mt-0.5"
                  />
                  <span className="text-muted-foreground">
                    Credit utilization tracking
                  </span>
                </li>
              </ul>
            </CardContent>
            <CardFooter className="pt-4">
              <Button variant="outline" className="w-full">
                Get Started
                <ArrowRight size={16} className="ml-2" />
              </Button>
            </CardFooter>
          </Card>

          {/* Premium Plan */}
          <Card className="relative flex flex-col border-primary/30 shadow-md hover:shadow-lg transition-shadow">
            <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1 text-xs font-medium rounded-bl-lg rounded-tr-lg">
              Recommended
            </div>
            <CardHeader className="pb-8">
              <CardTitle className="text-2xl">Premium Plan</CardTitle>
              <CardDescription className="mt-2">
                All features including smart reminders
              </CardDescription>
              <div className="mt-4">
                <span className="text-4xl font-bold">$5.97</span>
                <span className="text-muted-foreground">/month</span>
              </div>
            </CardHeader>
            <CardContent className="flex-grow">
              <ul className="space-y-3">
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>All features in the Free plan</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span className="flex items-center">
                    <Bell size={16} className="mr-2 text-primary" />
                    Smart payment reminders
                  </span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Personalized application recommendations</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Credit utilization tracking</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Advanced analytics dashboard</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Custom card tracking</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter className="pt-4">
              <Button className="w-full group">
                Subscribe Now
                <ArrowRight
                  size={16}
                  className="ml-2 transition-transform group-hover:translate-x-1"
                />
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </section>
  );
}
