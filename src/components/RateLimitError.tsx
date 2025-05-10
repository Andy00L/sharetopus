"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, Clock, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface RateLimitErrorProps {
  readonly redirectPath?: string;
}

export default function RateLimitError({ redirectPath }: RateLimitErrorProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleRetry = () => {
    setIsLoading(true);
    if (redirectPath) {
      router.push(redirectPath);
    } else {
      router.refresh();
    }
    // Optional: Add a timeout to reset loading if navigation takes too long
    setTimeout(() => setIsLoading(false), 3000);
  };

  return (
    <div className="flex flex-col w-full items-center justify-center py-12 px-4">
      <div className="w-full max-w-md mx-auto">
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Rate Limit Exceeded</AlertTitle>
          <AlertDescription>
            Rate limit exceeded. Too many requests in a short period.
          </AlertDescription>
        </Alert>

        <div className="bg-muted/30 rounded-lg p-6 text-center">
          <Clock className="h-12 w-12 mx-auto mb-4 text-primary/60" />
          <h2 className="text-xl font-semibold mb-2">Please Wait</h2>
          <p className="text-muted-foreground mb-6">
            Our system limits the number of requests to ensure fair usage and
            prevent abuse. Please wait a minute before trying again.
          </p>

          <Button
            className="cursor-pointer"
            onClick={handleRetry}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              "Try Again"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
