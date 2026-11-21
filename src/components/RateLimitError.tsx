"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, Clock, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

interface RateLimitErrorProps {
  readonly redirectPath?: string;
  readonly resetIn?: string | number;
}

/** Wait shown when resetIn is missing, zero, or not a number. */
const DEFAULT_WAIT_SECONDS = 60;
const COUNTDOWN_TICK_MS = 1000;
const RETRY_LOADING_RESET_MS = 3000;

function parseWaitSeconds(resetIn: string | number | undefined): number {
  const parsedSeconds = Number.parseInt(String(resetIn ?? ""), 10);
  return Number.isFinite(parsedSeconds) && parsedSeconds > 0
    ? parsedSeconds
    : DEFAULT_WAIT_SECONDS;
}

export default function RateLimitError({
  redirectPath,
  resetIn,
}: RateLimitErrorProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState<number>(() =>
    parseWaitSeconds(resetIn)
  );

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    if (redirectPath) {
      router.push(redirectPath);
    } else {
      router.refresh();
    }
    setTimeout(() => setIsLoading(false), RETRY_LOADING_RESET_MS);
  }, [router, redirectPath]);

  const formatTimeRemaining = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  };

  const tickCountdownWhileShown = useCallback(
    (countdownDisplay: HTMLSpanElement | null) => {
      if (!countdownDisplay || countdown <= 0) return;

      const tickTimer = setTimeout(() => {
        setCountdown(countdown - 1);
        if (countdown === 1) {
          handleRetry();
        }
      }, COUNTDOWN_TICK_MS);

      return () => clearTimeout(tickTimer);
    },
    [countdown, handleRetry]
  );

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
          <div className="mb-4 bg-background/60 py-2 px-4 rounded-md inline-block">
            <span
              ref={tickCountdownWhileShown}
              className="text-xl font-mono font-semibold"
            >
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
