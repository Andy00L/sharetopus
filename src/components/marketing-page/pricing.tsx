import { Check, X, ArrowRight, Clock, Rocket, Building } from "lucide-react";
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
    <section className="py-24 bg-white" id="pricing">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-block px-3 py-1 mb-6 rounded-full bg-primary/10 text-primary text-sm font-medium">
            Simple Pricing
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
            Choose the Right Plan for Your Social Media Needs
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            No matter your size, we have a plan that fits your social media
            management needs.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Free Plan */}
          <Card className="relative flex flex-col border-border/40 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-8">
              <div className="mb-4 flex items-center justify-center">
                <Clock className="h-10 w-10 text-primary/70" />
              </div>
              <CardTitle className="text-2xl text-center">Starter</CardTitle>
              <CardDescription className="text-center mt-2">
                For individual content creators just getting started
              </CardDescription>
              <div className="mt-4 text-center">
                <span className="text-4xl font-bold">$5.45</span>
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
                  <span>Connect up to 3 social accounts</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Post to multiple platforms at once</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Basic analytics</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Upload videos up to 100MB</span>
                </li>
                <li className="flex items-start">
                  <X
                    size={20}
                    className="mr-3 text-muted-foreground shrink-0 mt-0.5"
                  />
                  <span className="text-muted-foreground">
                    Content calendar
                  </span>
                </li>
                <li className="flex items-start">
                  <X
                    size={20}
                    className="mr-3 text-muted-foreground shrink-0 mt-0.5"
                  />
                  <span className="text-muted-foreground">Post scheduling</span>
                </li>
                <li className="flex items-start">
                  <X
                    size={20}
                    className="mr-3 text-muted-foreground shrink-0 mt-0.5"
                  />
                  <span className="text-muted-foreground">
                    Platform-specific formatting
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

          {/* Pro Plan */}
          <Card className="relative flex flex-col border-primary/30 shadow-md hover:shadow-lg transition-shadow scale-105 z-10">
            <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1 text-xs font-medium rounded-bl-lg rounded-tr-lg">
              Most Popular
            </div>
            <CardHeader className="pb-8">
              <div className="mb-4 flex items-center justify-center">
                <Rocket className="h-10 w-10 text-primary" />
              </div>
              <CardTitle className="text-2xl text-center">Pro</CardTitle>
              <CardDescription className="text-center mt-2">
                Perfect for content creators and small businesses
              </CardDescription>
              <div className="mt-4 text-center">
                <span className="text-4xl font-bold">$19</span>
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
                  <span>
                    Connect up to <strong>10 social accounts</strong>
                  </span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Post to multiple platforms at once</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Detailed analytics and performance tracking</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Upload videos up to 1GB</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Visual content calendar</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>
                    <strong>Advanced scheduling</strong> (up to 100 posts/month)
                  </span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Platform-specific formatting</span>
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

          {/* Business Plan */}
          <Card className="relative flex flex-col border-border/40 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-8">
              <div className="mb-4 flex items-center justify-center">
                <Building className="h-10 w-10 text-primary/70" />
              </div>
              <CardTitle className="text-2xl text-center">Business</CardTitle>
              <CardDescription className="text-center mt-2">
                For agencies and large teams managing multiple brands
              </CardDescription>
              <div className="mt-4 text-center">
                <span className="text-4xl font-bold">$49</span>
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
                  <span>
                    <strong>Unlimited</strong> social accounts
                  </span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Post to multiple platforms at once</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Advanced analytics with custom reports</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Upload videos up to 5GB</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Visual content calendar with team collaboration</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>
                    <strong>Unlimited scheduling</strong>
                  </span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Advanced platform-specific formatting</span>
                </li>
                <li className="flex items-start">
                  <Check
                    size={20}
                    className="mr-3 text-green-500 shrink-0 mt-0.5"
                  />
                  <span>Team roles and permissions</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter className="pt-4">
              <Button variant="outline" className="w-full">
                Contact Sales
                <ArrowRight size={16} className="ml-2" />
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="mt-16 text-center">
          <p className="text-muted-foreground mb-4">All plans include:</p>
          <div className="flex flex-wrap justify-center gap-4 max-w-3xl mx-auto">
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              TikTok Integration
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              Instagram Integration
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              Facebook Integration
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              Threads Integration
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              YouTube Integration
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              Email Support
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              Security & Compliance
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
