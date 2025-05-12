"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, Clock, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface RateLimitErrorProps {
  readonly redirectPath?: string;
  readonly resetIn?: string | number;
}

export default function RateLimitError({
  redirectPath,
  resetIn,
}: RateLimitErrorProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState<number>(
    resetIn ? parseInt(String(resetIn), 10) : 60
  );

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
  const formatTimeRemaining = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  };

  // Set up countdown effect
  useEffect(() => {
    // Only start countdown if we have a valid number greater than zero
    if (countdown <= 0) {
      return;
    }

    // Create interval to update countdown
    const timer = setInterval(() => {
      setCountdown((prevCount) => {
        // If we've reached zero, clear the interval and trigger retry
        if (prevCount <= 1) {
          clearInterval(timer);
          // Small delay before triggering retry to let UI update
          setTimeout(handleRetry, 500);
          return 0;
        }
        return prevCount - 1;
      });
    }, 1000);

    // Clean up interval on unmount
    return () => clearInterval(timer);
  }, [countdown]); // Only re-run if countdown changes

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
          {/* Add countdown display */}
          <div className="mb-4 bg-background/60 py-2 px-4 rounded-md inline-block">
            <span className="text-xl font-mono font-semibold">
              {formatTimeRemaining(countdown)}
            </span>
          </div>
          <p className="text-muted-foreground mb-6">
            Our system limits the number of requests to ensure fair usage. You
            can try again in <strong>{countdown}</strong> seconds, or the page
            will automatically refresh when the timer reaches zero.
          </p>

          <Button
            className="cursor-pointer"
            onClick={handleRetry}
            disabled={isLoading || countdown > 0}
          >
            {isLoading ? (
              <>
                <Loader className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : countdown > 0 ? (
              `Wait (${countdown}s)`
            ) : (
              "Try Again"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
