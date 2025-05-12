import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle, SparklesIcon } from "lucide-react";
import Link from "next/link";

export function SimpleSubscriptionPrompt() {
  return (
    <Card className="border-primary/20 px-4 py-6 shadow-lg max-w-2xl mx-auto animate-in fade-in-50 duration-500">
      <CardHeader className="pb-2 relative overflow-hidden">
        <div className="absolute -right-20 -top-20 bg-primary/5 w-64 h-64 rounded-full blur-3xl z-0"></div>

        <CardTitle className="text-2xl font-bold relative z-10">
          No active subscription
        </CardTitle>
        <p className="text-muted-foreground mt-2 relative z-10">
          You need to subscribe to create and schedule posts.
        </p>
      </CardHeader>

      <CardContent className="pt-4 pb-6">
        <div className="bg-muted/40 rounded-lg p-5 border border-muted">
          <h3 className="font-medium text-lg mb-4">Subscribe to...</h3>

          <ul className="space-y-4">
            <li className="flex items-start gap-3">
              <CheckCircle className="h-6 w-6 text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  Create and schedule unlimited posts
                </p>
                <p className="text-sm text-muted-foreground">
                  Never worry about content limits again
                </p>
              </div>
            </li>

            <li className="flex items-start gap-3">
              <CheckCircle className="h-6 w-6 text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Connect multiple social accounts</p>
                <p className="text-sm text-muted-foreground">
                  Manage all your platforms in one place
                </p>
              </div>
            </li>

            <li className="flex items-start gap-3">
              <CheckCircle className="h-6 w-6 text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Access all premium features</p>
                <p className="text-sm text-muted-foreground">
                  Increased Storage/Upload, post speed and priority support
                </p>
              </div>
            </li>
          </ul>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col sm:flex-row items-center gap-4 pt-2">
        <Button
          size="lg"
          className="w-full sm:w-auto bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-md hover:shadow-lg transition-all"
        >
          <Link href="/#pricing">
            <SparklesIcon className="mr-2 h-5 w-5" />
            Subscribe now
          </Link>
        </Button>

        <Link
          href="/#pricing"
          className="text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          View pricing details
        </Link>
      </CardFooter>
    </Card>
  );
}
