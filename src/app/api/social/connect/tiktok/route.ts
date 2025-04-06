// app/api/social/connect/tiktok/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabase } from "@/actions/api/supabase";
import { exchangeTikTokCode } from "@/lib/api/tiktok/auth";
import { getTikTokProfile } from "@/lib/api/tiktok/client";

export async function POST(req: Request) {
  try {
    // Récupérer le code envoyé dans le body
    const body = await req.json();
    const { code } = body;
    if (!code) {
      return NextResponse.json(
        { error: "Le paramètre 'code' est manquant" },
        { status: 400 }
      );
    }

    // Récupérer l'utilisateur connecté via Clerk
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Utilisateur non authentifié" },
        { status: 401 }
      );
    }

    // Échanger le code d'autorisation contre des tokens TikTok
    const tokenResponse = await exchangeTikTokCode(code);
    const { access_token, refresh_token, expires_in } = tokenResponse;

    // Récupérer les informations du profil TikTok
    const tiktokProfile = await getTikTokProfile(access_token);
    // On suppose que tiktokProfile contient au moins :
    // - tiktokProfile.id (l'identifiant TikTok de l'utilisateur)
    // - tiktokProfile.username (son nom d'utilisateur)

    // Insertion/Upsert du compte dans votre base de données Supabase
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
          extra: tiktokProfile, // enregistrez ici les données supplémentaires du profil
        },
      ],
      {
        onConflict: "user_id,platform,account_identifier", // Chaîne séparée par des virgules
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
    console.error("Erreur dans l'endpoint TikTok:", error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
