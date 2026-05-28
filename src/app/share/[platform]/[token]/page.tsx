import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";
import { validateShareToken } from "@/actions/server/share-link/validateShareToken";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { ConnectShareLinkButton } from "./ConnectShareLinkButton";

/**
 * Public landing page for a share link.
 *
 * Validates the token, looks up creator info, pre-checks account limits,
 * and renders a card inviting the friend to connect their TikTok.
 *
 * No auth required. The friend does not need a Sharetopus account.
 *
 * Route: /share/[platform]/[token]
 */

/** Masks an email address: first char + "****@" + domain */
function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return "****@unknown";
  return email[0] + "****" + email.slice(atIndex);
}

/** Builds a display identity from first_name/last_name or masked email */
function buildDisplayIdentity(user: {
  first_name: string | null;
  last_name: string | null;
  email: string;
}): string {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return maskEmail(user.email);
}

/** Maps validation failure reasons to user-friendly messages */
function friendlyErrorMessage(
  reason: "not_found" | "revoked" | "expired" | "max_uses_reached" | "invalid_format",
): string {
  switch (reason) {
    case "not_found":
      return "This share link does not exist or has been removed.";
    case "revoked":
      return "This share link has been revoked by its creator.";
    case "expired":
      return "This share link has expired.";
    case "max_uses_reached":
      return "This share link has reached its maximum number of uses.";
    case "invalid_format":
      return "This share link is not valid.";
  }
}

export default async function ShareLinkLandingPage({
  params,
}: {
  params: Promise<{ platform: string; token: string }>;
}) {
  const { platform, token } = await params;

  // MVP: only TikTok
  if (platform !== "tiktok") {
    redirect(`/share/${platform}/error?reason=unsupported_platform`);
  }

  // 1. Validate the share link token
  const validation = await validateShareToken(token);
  if (!validation.success) {
    redirect(`/share/${platform}/error?reason=${validation.reason}`);
  }

  const shareLink = validation.data;

  // 2. Look up creator display info
  const { data: creatorUser } = await adminSupabase
    .from("users")
    .select("first_name, last_name, email")
    .eq("id", shareLink.owner_principal_id)
    .single();

  const displayIdentity = creatorUser
    ? buildDisplayIdentity(creatorUser)
    : "A Sharetopus user";

  // 3. Pre-check creator account limits
  const subscription = await checkActiveSubscription(
    shareLink.owner_principal_id,
  );
  const limitsCheck = await checkAccountLimits(
    shareLink.owner_principal_id,
    subscription.tier,
  );

  if (!limitsCheck.success || !limitsCheck.canAddMore) {
    return (
      <SharePageShell>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <h1 className="text-xl font-semibold">Link Unavailable</h1>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center text-sm">
              This link cannot accept new connections right now. The owner has
              reached their account limit.
            </p>
          </CardContent>
        </Card>
      </SharePageShell>
    );
  }

  // 4. Render the landing card
  const initiateUrl = `/share/${platform}/${token}/initiate`;

  return (
    <SharePageShell>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          {/* TikTok icon placeholder */}
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-black">
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7 text-white"
              fill="currentColor"
            >
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.51a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.73a8.19 8.19 0 0 0 4.77 1.52V6.79a4.83 4.83 0 0 1-1.01-.1z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold">Connect your TikTok</h1>
          <p className="text-muted-foreground text-sm">
            <span className="font-medium text-foreground">
              {displayIdentity}
            </span>{" "}
            is inviting you to connect your TikTok account.
          </p>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Anything they post via their Sharetopus account will appear on your
            TikTok. You can revoke access at any time from TikTok&apos;s settings
            (Settings &gt; Privacy &gt; Apps and Websites).
          </p>
        </CardContent>
        <CardFooter className="flex gap-3 justify-center">
          <a
            href="https://www.tiktok.com"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
          >
            Cancel
          </a>
          <ConnectShareLinkButton initiateUrl={initiateUrl} />
        </CardFooter>
      </Card>
    </SharePageShell>
  );
}

/** Centered full-viewport shell for share pages */
function SharePageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      {children}
    </div>
  );
}
