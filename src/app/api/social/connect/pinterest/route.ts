// app/api/social/connect/pinterest/route.ts
import { adminSupabase } from "@/actions/api/supabase-client";
import { exchangePinterestCode } from "@/lib/api/pinterest/data/exchangePinterestCode";
import { getPinterestProfile } from "@/lib/api/pinterest/data/getPinterestProfile";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    // Parse URL parameters
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code) {
      console.error("[Pinterest] Missing 'code' parameter");
      return new NextResponse(
        `<html><body><script>window.close();</script>Le paramètre 'code' est manquant.</body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      );
    }

    // Get authenticated user
    const { userId } = await auth();

    if (!userId) {
      console.error("[Pinterest] User not authenticated");
      return new NextResponse(
        `<html><body><script>window.close();</script>Utilisateur non authentifié.</body></html>`,
        { status: 401, headers: { "Content-Type": "text/html" } }
      );
    }

    try {
      // Exchange authorization code for tokens
      console.log("[Pinterest] Exchanging code for tokens...");

      const tokenResponse = await exchangePinterestCode(code);

      console.log(
        "[Pinterest] Token exchange successful:",
        tokenResponse.access_token.substring(0, 10) + "..."
      );

      // Extract token data
      const { access_token, refresh_token, expires_in, scope } = tokenResponse;

      // Fetch user profile
      console.log("[Pinterest] Fetching user profile with scopes:", scope);
      let pinterestProfile;
      let profileFetchSuccessful = false;

      try {
        pinterestProfile = await getPinterestProfile(access_token);
        profileFetchSuccessful =
          !!pinterestProfile &&
          !pinterestProfile.bio?.includes("Error fetching") &&
          !pinterestProfile.bio?.includes("limited permissions");

        console.log(
          `[Pinterest] Profile retrieved. Success status: ${profileFetchSuccessful}. ID: ${pinterestProfile?.id}`
        );
      } catch (profileError) {
        console.error("[Pinterest] Error fetching profile:", profileError);
      }

      // Store in database
      console.log("[Pinterest] Storing account in database...");
      try {
        // Prepare account data
        const accountData = {
          user_id: userId,
          platform: "pinterest",
          account_identifier: pinterestProfile?.id ?? "",
          access_token,
          refresh_token,
          token_expires_at: new Date(
            Date.now() + expires_in * 1000
          ).toISOString(),
          username: pinterestProfile?.username ?? null,
          avatar_url: pinterestProfile?.profile_image_url ?? null,
          is_verified: pinterestProfile?.is_verified ?? false,
          bio_description: pinterestProfile?.bio ?? null,
          display_name:
            pinterestProfile?.business_name ??
            pinterestProfile?.username ??
            null,
          follower_count: pinterestProfile?.follower_count ?? null,
          extra: {
            profile: pinterestProfile,
            token_info: {
              scope,
              token_type: tokenResponse.token_type,
            },
            connection_status: {
              connected_at: new Date().toISOString(),
              profile_fetch_successful: profileFetchSuccessful,
            },
          },
        };
        // Log the account data for debugging
        console.log(
          "[Pinterest] Account data prepared:",
          JSON.stringify({
            ...accountData,
            access_token: accountData.access_token.substring(0, 10) + "...", // Truncate for security
          })
        );

        const { error: upsertError } = await adminSupabase
          .from("social_accounts")
          .upsert([accountData], {
            onConflict: "user_id, platform, account_identifier",
            ignoreDuplicates: false,
          });

        if (upsertError) {
          console.error("[Pinterest] Error upserting account:", upsertError);
        } else {
          console.log("[Pinterest] Account upserted successfully");
        }
      } catch (dbError) {
        console.error("[Pinterest] Database operation error:", dbError);
      }

      // Return HTML to close popup and refresh opener
      const htmlResponse = `
        <!DOCTYPE html>
        <html>
        <head><title>Connexion...</title></head>
        <body>
          <p>Connexion réussie. Cette fenêtre va se fermer...</p>
          <script>
            try {
              if (window.opener && window.opener.onPinterestConnectSuccess) {
                console.log('Calling opener refresh function...');
                window.opener.onPinterestConnectSuccess();
              } else {
                console.warn('Opener window or success function not found.');
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
    } catch (integrationError) {
      console.error("[Pinterest] Integration error:", integrationError);
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
    console.error("[Pinterest] Unhandled error in GET route:", error);
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
