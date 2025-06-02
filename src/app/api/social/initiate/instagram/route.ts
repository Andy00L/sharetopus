// app/api/social/initiate/instagram/route.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";
import { auth } from "@clerk/nextjs/server";
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
    if (!subscriptionCheck.success || !subscriptionCheck.isActive) {
      return NextResponse.json(
        { success: false, message: "Abonnement actif requis" },
        { status: 403 }
      );
    }

    // Check account limits
    const limitsCheck = await checkAccountLimits(
      userId,
      subscriptionCheck.plan
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
        `L'utilisateur ${userId} a tenté de connecter un compte au-delà de sa limite`
      );
      return NextResponse.json(
        {
          success: false,
          message: `Limite de comptes atteinte (${limitsCheck.currentCount}/${limitsCheck.maxAllowed})`,
        },
        { status: 403 }
      );
    }

    // Count existing Instagram accounts
    const { data: existingInstagramAccounts, error: countError } =
      await adminSupabase
        .from("social_accounts")
        .select("id")
        .eq("user_id", userId)
        .eq("platform", "instagram");

    if (countError) {
      console.error(
        "Erreur lors du comptage des comptes Instagram:",
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
    (await cookies()).set("instagram_auth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 15, // 15 minutes
      path: "/",
    });

    // Define required scopes for Instagram API with Instagram Login
    // Using the new scope values (old ones deprecated January 27, 2025)
    const scopes = [
      "instagram_business_basic",
      "instagram_business_content_publish",
    ].join(",");

    // Get configuration from environment variables
    const clientId = process.env.INSTAGRAM_CLIENT_ID;
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URL;

    if (!clientId) {
      console.error("L'ID client Instagram n'est pas configuré");
      return NextResponse.json(
        {
          success: false,
          message: "L'ID client Instagram n'est pas configuré",
        },
        { status: 500 }
      );
    }

    if (!redirectUri) {
      console.error(
        "L'URL de redirection OAuth pour Instagram n'est pas configurée"
      );
      return NextResponse.json(
        {
          success: false,
          message: "L'URL de redirection OAuth n'est pas configurée",
        },
        { status: 500 }
      );
    }

    // Construct Instagram OAuth URL using Instagram API with Instagram Login
    const authUrl = `https://www.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&scope=${encodeURIComponent(
      scopes
    )}&state=${state}&enable_fb_login=0&force_authentication=1`;
    console.log(`[Instagram OAuth] Generated auth URL for user ${userId}`);

    // Return the authorization URL to the client
    return NextResponse.json({
      success: true,
      authUrl: authUrl,
      existingAccounts: existingInstagramAccounts.length,
    });
  } catch (error) {
    console.error(
      "Erreur lors de l'initialisation de l'OAuth Instagram:",
      error
    );
    return NextResponse.json(
      { success: false, message: "Erreur serveur interne" },
      { status: 500 }
    );
  }
}
