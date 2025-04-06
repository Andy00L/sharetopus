// app/api/social/connect/tiktok/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { adminSupabase } from "@/actions/api/supabase"; // Import adminSupabase
import { exchangeTikTokCode } from "@/lib/api/tiktok/auth";
import { getTikTokProfile } from "@/lib/api/tiktok/client";

export async function GET(req: Request) {
  try {
    // Parse URL parameters
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code) {
      console.error("[TikTok] Missing 'code' parameter");
      return NextResponse.json(
        { error: "Le paramètre 'code' est manquant." },
        { status: 400 }
      );
    }

    // Get authenticated user
    const { userId } = await auth();

    if (!userId) {
      console.error("[TikTok] User not authenticated");
      return NextResponse.json(
        { error: "Utilisateur non authentifié." },
        { status: 401 }
      );
    }

    try {
      // Exchange authorization code for tokens
      console.log("[TikTok] Exchanging code for tokens...");
      const tokenResponse = await exchangeTikTokCode(code);
      console.log(
        "[TikTok] Token exchange successful:",
        tokenResponse.access_token.substring(0, 10) + "..."
      );

      // Extract token data
      const { access_token, refresh_token, expires_in, open_id, scope } =
        tokenResponse;

      // Log the scopes granted by the user
      console.log("[TikTok] Granted scopes:", scope);

      // Attempt to fetch full profile with proper error handling
      console.log("[TikTok] Fetching user profile with scopes:", scope);
      let tiktokProfile;
      try {
        tiktokProfile = await getTikTokProfile(access_token, open_id);
        console.log(
          "[TikTok] Profile successfully retrieved:",
          tiktokProfile.id
        );
      } catch (profileError) {
        console.error("[TikTok] Error fetching profile:", profileError);
        // Re-throw to be caught by outer try/catch
        throw profileError;
      }

      // Database operations with simplified approach - just insert
      console.log("[TikTok] Storing account in database...");
      try {
        // Prepare account data with rich profile information
        const accountData = {
          user_id: userId,
          platform: "tiktok",
          account_identifier: open_id,
          access_token,
          refresh_token,
          token_expires_at: new Date(
            Date.now() + expires_in * 1000
          ).toISOString(),
          extra: {
            profile: tiktokProfile,
            token_info: {
              scope,
              token_type: tokenResponse.token_type,
              refresh_expires_in: tokenResponse.refresh_expires_in,
            },
            connection_status: {
              connected_at: new Date().toISOString(),
              profile_fetch_successful: true,
            },
          },
        };

        // First try to delete any existing records to avoid conflicts
        try {
          await adminSupabase
            .from("social_accounts")
            .delete()
            .eq("user_id", userId)
            .eq("platform", "tiktok")
            .eq("account_identifier", open_id);

          console.log("[TikTok] Deleted any existing account records");
        } catch (deleteError) {
          console.error("[TikTok] Error during delete operation:", deleteError);
          // Continue anyway - the insert might still work
        }

        // Simple insert operation using adminSupabase
        const { error: insertError } = await adminSupabase
          .from("social_accounts")
          .insert([accountData]);

        if (insertError) {
          console.error("[TikTok] Error inserting account:", insertError);
        } else {
          console.log("[TikTok] Account created successfully");
        }
      } catch (dbError) {
        console.error("[TikTok] Database operation error:", dbError);
        // Don't rethrow - proceed to redirect
      }

      // Redirect to accounts page regardless of database outcome
      console.log("[TikTok] Redirecting to accounts page");
      return NextResponse.redirect(new URL("/accounts", req.url));
    } catch (integrationError) {
      console.error("[TikTok] Integration error:", integrationError);
      // Redirect to accounts page with error indicator
      return NextResponse.redirect(new URL("/accounts?status=error", req.url));
    }
  } catch (error) {
    console.error("[TikTok] Unhandled error:", error);
    let errorMessage = "Erreur interne";

    if (error instanceof Error) {
      errorMessage = error.message;
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
