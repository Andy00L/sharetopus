"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckIcon, XIcon, SparklesIcon, LockIcon } from "lucide-react";

export function SubscriptionPrompt() {
  return (
    <div className="flex flex-col items-center p-6 bg-gradient-to-b from-background to-muted/20 rounded-lg">
      <div className="max-w-3xl w-full mx-auto text-center mb-8 space-y-4">
        <Badge className="mb-2 bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
          Unlock Full Access
        </Badge>
        <h2 className="text-3xl font-bold tracking-tight">
          Upgrade to Unleash Your Content&apos;s Potential
        </h2>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Take your social media presence to the next level with premium
          scheduling, analytics, and optimization tools.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 w-full max-w-4xl">
        {/* Free Plan */}
        <Card className="border-muted/40">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Free Plan
              <Badge variant="outline" className="ml-2">
                Limited
              </Badge>
            </CardTitle>
            <CardDescription>
              Basic publishing tools for beginners
            </CardDescription>
            <div className="mt-4 flex items-baseline">
              <span className="text-3xl font-bold">$0</span>
              <span className="text-muted-foreground ml-1">/month</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert
              variant="destructive"
              className="bg-destructive/10 border-destructive/20 text-destructive"
            >
              <LockIcon className="h-4 w-4" />
              <AlertTitle>Limited Features</AlertTitle>
              <AlertDescription>
                You&apos;ve reached the limit of what you can do with the free
                plan.
              </AlertDescription>
            </Alert>

            <ul className="space-y-3">
              <li className="flex items-start">
                <CheckIcon className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                <span>Up to 5 scheduled posts per month</span>
              </li>
              <li className="flex items-start">
                <CheckIcon className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                <span>Single platform connection</span>
              </li>
              <li className="flex items-start opacity-50">
                <XIcon className="h-5 w-5 text-muted-foreground mr-2 mt-0.5 flex-shrink-0" />
                <span>No analytics or reporting</span>
              </li>
              <li className="flex items-start opacity-50">
                <XIcon className="h-5 w-5 text-muted-foreground mr-2 mt-0.5 flex-shrink-0" />
                <span>No content optimization tools</span>
              </li>
              <li className="flex items-start opacity-50">
                <XIcon className="h-5 w-5 text-muted-foreground mr-2 mt-0.5 flex-shrink-0" />
                <span>Basic support only</span>
              </li>
            </ul>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full">
              Current Plan
            </Button>
          </CardFooter>
        </Card>

        {/* Pro Plan */}
        <Card className="border-primary/50 shadow-lg relative overflow-hidden">
          <div className="absolute -right-10 -top-10 bg-primary/10 w-40 h-40 rounded-full blur-2xl z-0"></div>
          <CardHeader className="relative z-10">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center">
                Pro Plan
                <SparklesIcon className="h-5 w-5 text-yellow-500 ml-2" />
              </CardTitle>
              <Badge className="bg-primary hover:bg-primary/90">
                Recommended
              </Badge>
            </div>
            <CardDescription>
              Everything you need to grow your audience
            </CardDescription>
            <div className="mt-4 flex items-baseline">
              <span className="text-3xl font-bold">$19</span>
              <span className="text-muted-foreground ml-1">/month</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 relative z-10">
            <Alert className="bg-primary/10 border-primary/20 text-primary">
              <SparklesIcon className="h-4 w-4" />
              <AlertTitle>Unlock Premium Features</AlertTitle>
              <AlertDescription>
                Get unlimited posts, advanced analytics, and priority support.
              </AlertDescription>
            </Alert>

            <ul className="space-y-3">
              <li className="flex items-start">
                <CheckIcon className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                <span>
                  <strong>Unlimited</strong> scheduled posts
                </span>
              </li>
              <li className="flex items-start">
                <CheckIcon className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                <span>
                  Connect up to <strong>5 social platforms</strong>
                </span>
              </li>
              <li className="flex items-start">
                <CheckIcon className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                <span>Comprehensive analytics dashboard</span>
              </li>
              <li className="flex items-start">
                <CheckIcon className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                <span>AI-powered content optimization</span>
              </li>
              <li className="flex items-start">
                <CheckIcon className="h-5 w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                <span>Priority customer support</span>
              </li>
            </ul>
          </CardContent>
          <CardFooter className="relative z-10">
            <Button className="w-full" size="lg">
              Upgrade Now
            </Button>
          </CardFooter>
        </Card>
      </div>

      <div className="mt-10 text-center max-w-xl">
        <p className="text-sm text-muted-foreground mb-4">
          All plans include a 14-day money-back guarantee. Upgrade or cancel
          anytime. No credit card required for trial.
        </p>
        <div className="flex flex-wrap gap-3 justify-center text-sm">
          <Badge variant="outline" className="bg-background">
            Secure Payments
          </Badge>
          <Badge variant="outline" className="bg-background">
            14-Day Guarantee
          </Badge>
          <Badge variant="outline" className="bg-background">
            Dedicated Support
          </Badge>
        </div>
      </div>
    </div>
  );
}
