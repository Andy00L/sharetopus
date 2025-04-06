// app/api/social/connect/tiktok/route.ts
import { supabase } from "@/actions/api/supabase";
import { exchangeTikTokCode } from "@/lib/api/tiktok/auth";
import { getTikTokProfile } from "@/lib/api/tiktok/client";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * GET handler for TikTok OAuth callback.
 * TikTok will redirect the user to this route with query parameters (code, state, etc.).
 */
export async function GET(req: Request) {
  try {
    // Parse the URL and extract the query parameters
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    if (!code) {
      return NextResponse.json(
        { error: "Le paramètre 'code' est manquant." },
        { status: 400 }
      );
    }

    // Optionally, you can validate the 'state' parameter here against what you originally set.

    // Get the currently authenticated user from Clerk
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Utilisateur non authentifié." },
        { status: 401 }
      );
    }
    try {
      // Exchange the authorization code for tokens
      console.error("[TikTok] Exchanging code for tokens...");
      // Exchange the authorization code for tokens from TikTok
      const tokenResponse = await exchangeTikTokCode(code);
      // Add after token exchange in your route.ts
      console.error(
        "[TikTok] Token response:",
        JSON.stringify(tokenResponse, null, 2)
      );
      const { access_token, refresh_token, expires_in, open_id } =
        tokenResponse;

      // Create a minimal profile using data from the token response
      console.error("[TikTok] Fetching user profile...");
      let tiktokProfile;
      try {
        tiktokProfile = await getTikTokProfile(access_token, open_id);
        console.error(
          "[TikTok] Profile:",
          JSON.stringify(tiktokProfile, null, 2)
        );
      } catch (profileError) {
        console.error("[TikTok] Profile fetch error:", profileError);

        // Use minimal profile from token data as fallback
        tiktokProfile = {
          id: open_id,
          username: "TikTok User",
          display_name: "TikTok User",
        };

        console.log("[TikTok] Using minimal profile from token data");
      }

      // Store account in database
      console.log("[TikTok] Storing account in database...");
      const { data: existingAccount } = await supabase
        .from("social_accounts")
        .select("id")
        .eq("user_id", userId)
        .eq("platform", "tiktok")
        .eq("account_identifier", tiktokProfile.id)
        .single();

      if (existingAccount) {
        // Update existing record
        await supabase
          .from("social_accounts")
          .update({
            access_token,
            refresh_token,
            token_expires_at: new Date(
              Date.now() + expires_in * 1000
            ).toISOString(),
            extra: tiktokProfile,
          })
          .eq("id", existingAccount.id);
      } else {
        // Insert new record
        await supabase.from("social_accounts").insert([
          {
            user_id: userId,
            platform: "tiktok",
            account_identifier: tiktokProfile.id,
            access_token,
            refresh_token,
            token_expires_at: new Date(
              Date.now() + expires_in * 1000
            ).toISOString(),
            extra: tiktokProfile,
          },
        ]);
      }
    } catch (error) {
      console.error("[TikTok] Error during TikTok integration:", error);
    }

    // Redirect user to accounts page regardless of possible errors
    // This ensures user doesn't get stuck on error page
    return NextResponse.redirect(new URL("/accounts", req.url));
  } catch (error: unknown) {
    let errorMessage = "Erreur interne";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    console.error("[TikTok] Unhandled error:", error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * POST handler implementation similar to GET but returns JSON
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { code } = body;
    if (!code) {
      return NextResponse.json(
        { error: "Le paramètre 'code' est manquant." },
        { status: 400 }
      );
    }

    // Authentication check
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Utilisateur non authentifié." },
        { status: 401 }
      );
    }

    // Exchange code for tokens
    const tokenResponse = await exchangeTikTokCode(code);
    const { access_token, refresh_token, expires_in, open_id } = tokenResponse;

    // Attempt to fetch profile with full implementation
    let tiktokProfile;
    try {
      tiktokProfile = await getTikTokProfile(access_token, open_id);
    } catch (profileError) {
      console.error("[TikTok] POST: Error fetching profile:", profileError);

      // Create minimal profile from token data as fallback
      tiktokProfile = {
        id: open_id,
        username: "TikTok User",
        display_name: "TikTok User",
      };
    }

    // Store in database
    const { error } = await supabase.from("social_accounts").upsert(
      [
        {
          user_id: userId,
          platform: "tiktok",
          account_identifier: tiktokProfile.id,
          access_token,
          refresh_token,
          token_expires_at: new Date(
            Date.now() + expires_in * 1000
          ).toISOString(),
          extra: tiktokProfile,
        },
      ],
      {
        onConflict: "user_id,platform,account_identifier",
      }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      message: "Compte TikTok connecté avec succès",
      profile: tiktokProfile,
    });
  } catch (error: unknown) {
    let errorMessage = "Erreur interne";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    console.error("[TikTok] POST error:", error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
