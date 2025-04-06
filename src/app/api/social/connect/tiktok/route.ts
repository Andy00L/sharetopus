// app/api/social/connect/tiktok/route.ts
import { adminSupabase } from "@/actions/api/supabase"; // Import adminSupabase
import { exchangeTikTokCode } from "@/lib/api/tiktok/auth";
import { getTikTokProfile } from "@/lib/api/tiktok/client";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    // Parse URL parameters
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code) {
      console.error("[TikTok] Missing 'code' parameter");
      return new NextResponse(
        `<html><body><script>window.close();</script>Le paramètre 'code' est manquant.</body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      );
    }

    // Get authenticated user
    const { userId } = await auth();

    if (!userId) {
      console.error("[TikTok] User not authenticated");
      // --- FIX: Return HTML to close popup even on error ---
      return new NextResponse(
        `<html><body><script>window.close();</script>Utilisateur non authentifié.</body></html>`,
        { status: 401, headers: { "Content-Type": "text/html" } }
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
              profile_fetch_successful:
                !tiktokProfile?.bio_description?.includes(
                  "Error fetching complete profile"
                ) &&
                !tiktokProfile?.bio_description?.includes(
                  "limited permissions"
                ),
            },
          },
        };

        // Upsert logic: Insert or update based on user_id, platform, account_identifier
        const { error: upsertError } = await adminSupabase
          .from("social_accounts")
          .upsert([accountData], {
            onConflict: "user_id, platform, account_identifier", // Define your unique constraint columns
            ignoreDuplicates: false, // Ensure it updates if conflict occurs
          });

        if (upsertError) {
          console.error("[TikTok] Error upserting account:", upsertError);
          // Even if DB fails, try to close popup, maybe indicate error
        } else {
          console.log("[TikTok] Account upserted successfully");
        }
      } catch (dbError) {
        console.error("[TikTok] Database operation error:", dbError);
        // Proceed to close popup
      }

      // --- FIX: Return HTML to close popup and refresh opener ---
      const htmlResponse = `
        <!DOCTYPE html>
        <html>
        <head><title>Connexion...</title></head>
        <body>
          <p>Connexion réussie. Cette fenêtre va se fermer...</p>
          <script>
            try {
              if (window.opener && window.opener.onTikTokConnectSuccess) {
                console.log('Calling opener refresh function...');
                window.opener.onTikTokConnectSuccess();
              } else {
                console.warn('Opener window or success function not found.');
                // Optionally redirect parent if opener communication fails
                // window.opener.location.href = '/accounts?status=success';
              }
            } catch (e) {
              console.error('Error calling opener function:', e);
            } finally {
              console.log('Closing popup window...');
              window.close();
            }
          </script>
        </body>
        </html>
      `;
      return new NextResponse(htmlResponse, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
      // --- End of FIX ---
    } catch (integrationError) {
      console.error("[TikTok] Integration error:", integrationError);
      // Still try to close the popup, maybe show error message first
      const errorHtml = `
        <!DOCTYPE html><html><body>
        <p>Erreur lors de la connexion: ${
          integrationError instanceof Error
            ? integrationError.message
            : "Erreur inconnue"
        }</p>
        <script>window.close();</script>
        </body></html>`;
      return new NextResponse(errorHtml, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    }
  } catch (error) {
    console.error("[TikTok] Unhandled error in GET route:", error);
    const errorHtml = `
      <!DOCTYPE html><html><body>
      <p>Erreur interne du serveur.</p>
      <script>window.close();</script>
      </body></html>`;
    return new NextResponse(errorHtml, {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
}
