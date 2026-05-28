import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * Error page for share link failures.
 *
 * Displays a user-friendly error message based on the reason query param.
 * No technical jargon. Each reason maps to a clear explanation.
 *
 * Route: /share/[platform]/error?reason=<reason>
 */

const REASON_MESSAGES: Record<string, string> = {
  not_found: "This share link does not exist or has been removed.",
  revoked: "This share link has been revoked by its creator.",
  expired: "This share link has expired.",
  max_uses_reached:
    "This share link has reached its maximum number of uses.",
  invalid_format: "This share link is not valid.",
  owner_account_limit_reached:
    "This link cannot accept new connections right now. The owner has reached their account limit.",
  rate_limited:
    "Too many connection attempts. Please wait a minute and try again.",
  unsupported_platform: "This platform is not supported for share links.",
  configuration_error:
    "Something went wrong on our end. Please try again later.",
  internal_error:
    "Something went wrong on our end. Please try again later.",
  share_link_not_found:
    "The share link associated with this connection could not be found.",
  share_link_revoked: "This share link has been revoked by its creator.",
  share_link_expired: "This share link has expired.",
  share_link_max_uses_reached:
    "This share link has reached its maximum number of uses.",
};

const DEFAULT_MESSAGE =
  "Something went wrong. Please contact the person who shared this link.";

export default async function ShareErrorPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const { platform } = await params;
  const { reason } = await searchParams;

  const message =
    reason && REASON_MESSAGES[reason] ? REASON_MESSAGES[reason] : DEFAULT_MESSAGE;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          {/* Error icon */}
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-7 w-7 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold">Connection Failed</h1>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm text-center">
            {message}
          </p>
        </CardContent>
        <CardFooter className="justify-center">
          <Link href="https://www.tiktok.com">
            <Button variant="outline">Close</Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
