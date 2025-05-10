//api/social/initiate/linkedin/route.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";
import { auth } from "@clerk/nextjs/server";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    console.log("LinkedIn initiation started");

    // Authenticate user
    const { userId } = await auth();
    console.log("User authenticated:", userId ? "Yes" : "No");

    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Non autorisé - Authentification requise" },
        { status: 401 }
      );
    }
    console.log("Checking subscription");

    // Check subscription status
    const subscriptionCheck = await checkActiveSubscription(userId);
    console.log("Subscription check result:", subscriptionCheck);

    if (!subscriptionCheck.success || !subscriptionCheck.isActive) {
      return NextResponse.json(
        { success: false, message: "Abonnement actif requis" },
        { status: 403 }
      );
    }

    // Check account limits
    console.log("Checking account limits");

    const limitsCheck = await checkAccountLimits(
      userId,
      subscriptionCheck.plan
    );
    console.log("Limits check result:", limitsCheck);

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

    // Count existing LinkedIn accounts to prevent unnecessary connections
    const { data: existingLinkedInAccounts, error: countError } =
      await adminSupabase
        .from("social_accounts")
        .select("id")
        .eq("user_id", userId)
        .eq("platform", "linkedin");

    if (countError) {
      console.error(
        "Erreur lors du comptage des comptes LinkedIn:",
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
    console.log("Attempting to set state cookie");

    try {
      (await cookies()).set("linkedin_auth_state", state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 15,
        path: "/",
      });
      console.log("Cookie set successfully");
    } catch (cookieError) {
      console.error("Error setting cookie:", cookieError);
      return NextResponse.json(
        { success: false, message: "Error setting authentication state" },
        { status: 500 }
      );
    }

    // Define required scopes for LinkedIn
    const scopes = ["openid", "profile", "email", "w_member_social"].join(" ");

    // Get redirect URI from environment variables
    const redirectUri = process.env.LINKEDIN_REDIRECT_URL;

    if (!redirectUri) {
      console.error("L'URL de redirection OAuth n'est pas configurée");
      return NextResponse.json(
        {
          success: false,
          message: "L'URL de redirection OAuth n'est pas configurée",
        },
        { status: 500 }
      );
    }

    // Construct LinkedIn OAuth URL
    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?client_id=${
      process.env.LINKEDIN_CLIENT_ID
    }&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${state}&response_type=code&prompt=login`;

    // Return the authorization URL to the client
    return NextResponse.json({
      success: true,
      authUrl: authUrl,
      existingAccounts: existingLinkedInAccounts.length,
    });
  } catch (error) {
    console.error(
      "Erreur lors de l'initialisation de l'OAuth LinkedIn:",
      error
    );
    return NextResponse.json(
      { success: false, message: "Erreur serveur interne" },
      { status: 500 }
    );
  }
}
