// app/api/social/connect/tiktok/route.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import { exchangeTikTokCode } from "@/lib/api/tiktok/data/exchangeTikTokCode";
import { getTikTokProfile } from "@/lib/api/tiktok/data/getTikTokProfile";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized - Authentication required" },
        { status: 401 }
      );
    }
    // Parse URL parameters
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    // First check for OAuth errors returned by TikTok
    if (error) {
      console.error(
        `[TikTok Connect Route] OAuth error: ${error} - ${errorDescription}`
      );
      return new NextResponse(
        `
    <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Connection Failed</title>
    <script>
      if (window.opener) {
        window.opener.onTikTokConnectFailure("${errorDescription ?? error}");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>TikTok connection failed: ${
      errorDescription ?? error
    }. This window will close automatically.</p>
  </body>
</html>
    `,
        {
          status: 400,
          headers: { "Content-Type": "text/html" },
        }
      );
    }

    const storedState = (await cookies()).get("tiktok_auth_state")?.value;

    // Verify state matches to prevent CSRF attacks
    if (!state || !storedState || state !== storedState) {
      console.error(
        `[TikTok Connect Route] State verification failed. Received: ${state}, Stored: ${storedState}`
      );
      return new NextResponse(
        `
    <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Security Verification Failed</title>
    <script>
      if (window.opener) {
        window.opener.onTikTokConnectFailure("Security verification failed");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>The security verification has failed. This window will close automatically.</p>
  </body>
</html>
    `,
        {
          status: 400,
          headers: { "Content-Type": "text/html" },
        }
      );
    }

    // Clear the state cookie immediately after verification
    (await cookies()).delete("tiktok_auth_state");
    console.log(`[TikTok Connect Route] State verified and cookie cleared`);

    if (!code) {
      console.error("[TikTok Connect Route] Missing 'code' parameter");
      return new NextResponse(
        `
        <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Missing Parameter</title>
    <script>
      if (window.opener) {
        window.opener.onTikTokConnectFailure("Missing authorization code");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>Authorization code is missing. This window will close automatically.</p>
  </body>
</html>
        `,
        {
          status: 400,
          headers: { "Content-Type": "text/html" },
        }
      );
    }

    try {
      // Exchange authorization code for tokens
      console.log("[TikTok Connect Route] Exchanging code for tokens...");
      const tokenResponse = await exchangeTikTokCode(code);
      console.log(
        "[TikTok Connect Route]  Token exchange successful:",
        tokenResponse.access_token.substring(0, 10) + "..."
      );

      // Extract token data
      const { access_token, refresh_token, expires_in, open_id, scope } =
        tokenResponse;

      // Log the scopes granted by the user
      console.log("[TikTok Connect Route]  Granted scopes:", scope);

      // Attempt to fetch full profile with proper error handling
      console.log(
        "[TikTok Connect Route]  Fetching user profile with scopes:",
        scope
      );
      let tiktokProfile;
      let profileFetchSuccessful = false;
      try {
        tiktokProfile = await getTikTokProfile(access_token, open_id);
        profileFetchSuccessful =
          !!tiktokProfile && // Ensure profile exists
          !tiktokProfile.bio_description?.includes("Error fetching") &&
          !tiktokProfile.bio_description?.includes("limited permissions");

        console.log(
          `[TikTok Connect Route]  Profile retrieved. Success status: ${profileFetchSuccessful}. ID: ${tiktokProfile?.id}`
        );
      } catch (profileError) {
        console.error(
          "[TikTok Connect Route]  Error fetching profile:",
          profileError
        );
      }

      // Database operations with simplified approach - just insert
      console.log("[TikTok Connect Route]  Storing account in database...");
      try {
        // Prepare account data with rich profile information
        const accountData = {
          user_id: userId,
          platform: "tiktok",
          account_identifier: open_id,
          is_available: true,
          access_token,
          refresh_token,
          token_expires_at: new Date(
            Date.now() + expires_in * 1000
          ).toISOString(),
          username: tiktokProfile?.username ?? null, // Use null if profile/username missing
          avatar_url: tiktokProfile?.avatar_url ?? null, // Use null if profile/avatar missing
          is_verified: tiktokProfile?.is_verified ?? false, // Default to false if missing
          display_name: tiktokProfile?.display_name ?? null, // Use null if profile/display_name missing
          follower_count: tiktokProfile?.follower_count ?? null, // Use null if profile/count missing
          following_count: tiktokProfile?.follower_count ?? null,
          bio_description: tiktokProfile?.bio_description ?? null,
          extra: {
            profile: tiktokProfile,
            token_info: {
              scope,
              token_type: tokenResponse.token_type,
              refresh_expires_in: tokenResponse.refresh_expires_in,
            },
            connection_status: {
              connected_at: new Date().toISOString(),
              profile_fetch_successful: profileFetchSuccessful,
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
          console.error(
            "[TikTok Connect Route]  Error upserting account:",
            upsertError
          );
          // Even if DB fails, try to close popup, maybe indicate error
        } else {
          console.log("[TikTok Connect Route]  Account upserted successfully");
        }
      } catch (dbError) {
        console.error(
          "[TikTok Connect Route]  Database operation error:",
          dbError
        );
        // Proceed to close popup
      }

      // --- FIX: Return HTML to close popup and refresh opener ---
      const htmlResponse = `
      <!DOCTYPE html>
<html>
<head>
  <title>Connecting...</title>
  <meta charset="UTF-8">
</head>
<body>
  <p>Connection successful. This window will close shortly...</p>
  <script>
    window.onload = function() {
      try {
        if (window.opener && window.opener.onTikTokConnectSuccess) {
          window.opener.onTikTokConnectSuccess();
          // Wait before closing to ensure the function completes
          setTimeout(function() { 
            window.close(); 
          }, 500);
        } else {
          console.warn('Opener window or success function not found.');
          window.close();
        }
      } catch (e) {
        console.error('Error calling opener function:', e);
        window.close();
      }
    };
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
      console.error(
        "[TikTok Connect Route]  Integration error:",
        integrationError
      );
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
    console.error(
      "[TikTok Connect Route]  Unhandled error in GET route:",
      error
    );
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
