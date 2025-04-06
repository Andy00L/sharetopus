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
      // Exchange the authorization code for tokens from TikTok
      const tokenResponse = await exchangeTikTokCode(code);
      // Add after token exchange in your route.ts
      console.log(
        "[TikTok] Token response:",
        JSON.stringify(tokenResponse, null, 2)
      );
      const { access_token, refresh_token, expires_in, open_id } =
        tokenResponse;

      // Create a minimal profile using data from the token response
      const tiktokProfile = {
        id: open_id,
        username: "TikTok User",
        display_name: "TikTok User",
        avatar_url: null,
        is_verified: false,
        bio_description: null,
      };
      // Store in database as usual
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
    } catch (error) {
      console.error("Immediate Solution:", error);
    }
    // After successful processing, redirect the user to a success or accounts page
    return NextResponse.redirect(new URL("/accounts", req.url));
  } catch (error: unknown) {
    let errorMessage = "Erreur interne";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    console.error("Erreur dans l'endpoint TikTok GET:", error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * POST handler for TikTok connection (if needed).
 * Expects JSON body containing { code: string }.
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

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Utilisateur non authentifié." },
        { status: 401 }
      );
    }

    const tokenResponse = await exchangeTikTokCode(code);
    const { access_token, refresh_token, expires_in } = tokenResponse;

    const tiktokProfile = await getTikTokProfile(access_token);

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
    console.error("Erreur dans l'endpoint TikTok POST:", error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
