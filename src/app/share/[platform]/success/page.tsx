import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * Success page shown after a friend completes the TikTok OAuth flow
 * via a share link.
 *
 * Displays confirmation with the connected account name and
 * instructions for revoking access from TikTok settings.
 *
 * Route: /share/[platform]/success?account=<masked_username>
 */
export default async function ShareSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string }>;
  searchParams: Promise<{ account?: string }>;
}) {
  const { platform } = await params;
  const { account } = await searchParams;

  const platformLabel =
    platform === "tiktok" ? "TikTok" : platform.charAt(0).toUpperCase() + platform.slice(1);
  const accountDisplay = account ? `@${account}` : "your account";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          {/* Check icon */}
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-7 w-7 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold">Connection Successful</h1>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm text-center">
            Your {platformLabel} account ({accountDisplay}) has been connected
            successfully. You can close this window.
          </p>
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">
                To revoke access:
              </span>{" "}
              Open {platformLabel} &gt; Settings &gt; Privacy &gt; Apps and
              Websites &gt; find Sharetopus &gt; Remove.
            </p>
          </div>
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
