// app/api/social/connect/pinterest/route.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import { exchangePinterestCode } from "@/lib/api/pinterest/data/exchangePinterestCode";
import { getPinterestProfile } from "@/lib/api/pinterest/data/getPinterestProfile";
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
    // First check for OAuth errors returned by Pinterest
    if (error) {
      console.error(
        `[Pinterest Connect route] OAuth error: ${error} - ${errorDescription}`
      );
      return new Response(
        `
       <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Connection Failed</title>
    <script>
      if (window.opener) {
        window.opener.onPinterestConnectFailure("${errorDescription ?? error}");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>Pinterest connection failed: ${
      errorDescription ?? error
    }. This window will close automatically.</p>
  </body>
</html>
        `,
        {
          status: 400,
          headers: {
            "Content-Type": "text/html",
          },
        }
      );
    }

    // Get stored state from cookie and verify it matches
    const storedState = (await cookies()).get("pinterest_auth_state")?.value;
    // Verify state matches to prevent CSRF attacks
    if (!state || !storedState || state !== storedState) {
      console.error(
        `[Pinterest Connect route] State verification failed. Received: ${state}, Stored: ${storedState}`
      );
      return new Response(
        `
    <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Security Verification Failed</title>
    <script>
      if (window.opener) {
        window.opener.onPinterestConnectFailure("Security verification failed");
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
          headers: {
            "Content-Type": "text/html",
          },
        }
      );
    }

    // Clear the state cookie immediately after verification
    (await cookies()).delete("pinterest_auth_state");
    console.log(`[Pinterest Connect route] State verified and cookie cleared`);

    if (!code) {
      console.error(`[Pinterest Connect route] Missing 'code' parameter`);

      return new Response(
        `
      <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Missing Parameter</title>
    <script>
      if (window.opener) {
        window.opener.onPinterestConnectFailure("Missing authorization code");
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
          headers: {
            "Content-Type": "text/html",
          },
        }
      );
    }

    // Exchange code for tokens
    console.log("[Pinterest Connect route] Exchanging code for tokens...");
    const tokenResponse = await exchangePinterestCode(code);

    if (!tokenResponse?.access_token) {
      console.error("[Pinterest Connect route] Token exchange failed");
      return new Response(
        `
        <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Token Exchange Failed</title>
    <script>
      if (window.opener) {
        window.opener.onPinterestConnectFailure("Token exchange failure");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>Failed to exchange the authorization code. This window will close automatically.</p>
  </body>
</html>
         `,
        {
          status: 400,
          headers: {
            "Content-Type": "text/html",
          },
        }
      );
    }

    console.log(
      "[Pinterest Connect route] Token exchange successful:",
      tokenResponse.access_token.substring(0, 10) + "..."
    );

    // Extract token data
    const { access_token, refresh_token, expires_in, scope } = tokenResponse;

    // Fetch user profile
    console.log(
      "[Pinterest Connect route] Fetching user profile with scopes:",
      scope
    );
    let pinterestProfile;
    let profileFetchSuccessful = false;

    try {
      pinterestProfile = await getPinterestProfile(access_token);
      profileFetchSuccessful =
        !!pinterestProfile &&
        !pinterestProfile.bio?.includes("Error fetching") &&
        !pinterestProfile.bio?.includes("limited permissions");

      console.log(
        `[Pinterest Connect route]  Profile retrieved. Success status: ${profileFetchSuccessful}. ID: ${pinterestProfile?.id}`
      );
    } catch (profileError) {
      console.error(
        "[Pinterest Connect route]  Error fetching profile:",
        profileError
      );
    }

    // Store in database
    console.log("[Pinterest Connect route]  Storing account in database...");
    try {
      // Prepare account data
      const accountData = {
        user_id: userId,
        platform: "pinterest",
        account_identifier: pinterestProfile?.id ?? "",
        is_availble: true,
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
          pinterestProfile?.business_name ?? pinterestProfile?.username ?? null,
        follower_count: pinterestProfile?.follower_count ?? null,
        following_count: pinterestProfile?.following_count ?? null,
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
        "[Pinterest Connect route]  Account data prepared:",
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
        console.error(
          "[Pinterest Connect route]  Error upserting account:",
          upsertError
        );
      } else {
        console.log("[Pinterest Connect route]  Account upserted successfully");
      }
    } catch (dbError) {
      console.error(
        "[Pinterest Connect route]  Database operation error:",
        dbError
      );
    }

    // Return HTML to close popup and refresh opener
    // In your Pinterest callback route.ts, change this:
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
        if (window.opener && window.opener.onPinterestConnectSuccess) {
          window.opener.onPinterestConnectSuccess();
          // Wait before closing to ensure the function completes
          setTimeout(function() { 
            window.close(); 
          }, 500);
        } else {
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
  } catch (error) {
    console.error(
      "[Pinterest Connect route] Unhandled error in GET route:",
      error
    );
    return new Response(
      `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Unexpected Error</title>
    <script>
      if (window.opener) {
        window.opener.onPinterestConnectFailure("An unexpected error occurred");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>An unexpected error occurred. This window will close automatically.</p>
  </body>
</html>
  `,
      {
        status: 500,
        headers: {
          "Content-Type": "text/html",
        },
      }
    );
  }
}
