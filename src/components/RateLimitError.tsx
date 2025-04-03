"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, Clock } from "lucide-react";
import { useRouter } from "next/navigation";

interface RateLimitErrorProps {
  readonly message?: string;
  readonly redirectPath?: string;
  readonly buttonText?: string;
}

export default function RateLimitError({
  message = "Rate limit exceeded. Too many requests in a short period.",
  redirectPath,
  buttonText = "Try Again",
}: RateLimitErrorProps) {
  const router = useRouter();

  const handleRetry = () => {
    if (redirectPath) {
      router.push(redirectPath);
    } else {
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="w-full max-w-md mx-auto">
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Rate Limit Exceeded</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>

        <div className="bg-muted/30 rounded-lg p-6 text-center">
          <Clock className="h-12 w-12 mx-auto mb-4 text-primary/60" />
          <h2 className="text-xl font-semibold mb-2">Please Wait</h2>
          <p className="text-muted-foreground mb-6">
            Our system limits the number of requests to ensure fair usage and
            prevent abuse. Please wait a minute before trying again.
          </p>

          <Button onClick={handleRetry}>{buttonText}</Button>
        </div>
      </div>
    </div>
  );
}
