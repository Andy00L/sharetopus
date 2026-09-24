// app/api/social/initiate/tiktok/route.ts
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    // Authenticate user
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Non autorisé - Authentification requise" },
        { status: 401 }
      );
    }

    // Check subscription status
    const subscriptionCheck = await checkActiveSubscription(userId);
    if (subscriptionCheck.status === "unavailable") {
      return NextResponse.json(
        { success: false, message: "Could not check your subscription. Please try again." },
        { status: 503 }
      );
    }
    if (!subscriptionCheck.isActive) {
      return NextResponse.json(
        { success: false, message: "Abonnement actif requis" },
        { status: 403 }
      );
    }

    // Check account limits
    const limitsCheck = await checkAccountLimits(
      userId,
      subscriptionCheck.tier,
    );

    if (!limitsCheck.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Impossible de vérifier les limites de compte",
        },
        { status: 500 }
      );
    }

    if (!limitsCheck.canAddMore) {
      console.warn(
        `[TikTok OAuth] L'utilisateur ${userId} a tenté de connecter un compte au-delà de sa limite`
      );
      return NextResponse.json(
        {
          success: false,
          message: `Limite de comptes atteinte (${limitsCheck.currentCount}/${limitsCheck.maxAllowed})`,
        },
        { status: 403 }
      );
    }

    // Count existing TikTok accounts
    const { data: existingTikTokAccounts, error: countError } = await runQuery(
      db
        .select({ id: social_accounts.id })
        .from(social_accounts)
        .where(
          and(
            eq(social_accounts.principal_id, userId),
            eq(social_accounts.platform, "tiktok"),
          ),
        ),
    );

    if (countError) {
      console.error(
        "[TikTok OAuth] Erreur lors du comptage des comptes TikTok:",
        countError
      );
      return NextResponse.json(
        { success: false, message: "Erreur de base de données" },
        { status: 500 }
      );
    }

    // Generate secure state token to prevent CSRF
    const state = nanoid(32);

    // Store state in a secure, HTTP-only cookie
    (await cookies()).set("tiktok_auth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 15, // 15 minutes
      path: "/",
    });

    // Define required scopes for TikTok
    const scopes =
      "user.info.basic,user.info.profile,video.publish,video.upload,user.info.stats";

    // Get redirect URI from environment variables
    const redirectUri = process.env.TIKTOK_REDIRECT_URL;

    if (!redirectUri) {
      console.error(
        "[TikTok OAuth] L'URL de redirection OAuth pour TikTok n'est pas configurée"
      );
      return NextResponse.json(
        {
          success: false,
          message: "L'URL de redirection OAuth n'est pas configurée",
        },
        { status: 500 }
      );
    }

    const clientKey =
      process.env.NODE_ENV === "development"
        ? process.env.TIKTOK_CLIENT_KEY_DEV
        : process.env.TIKTOK_CLIENT_KEY;
    // Construct TikTok OAuth URL
    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${encodeURIComponent(
      scopes
    )}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${state}&response_type=code&force_login=true&auth_type=reauthenticate&timestamp=${Date.now()}`;

    // Return the authorization URL to the client
    return NextResponse.json({
      success: true,
      authUrl: authUrl,
      existingAccounts: existingTikTokAccounts.length,
    });
  } catch (error) {
    console.error(
      "[TikTok OAuth] Erreur lors de l'initialisation de l'OAuth TikTok:",
      error
    );
    return NextResponse.json(
      { success: false, message: "Erreur serveur interne" },
      { status: 500 }
    );
  }
}
