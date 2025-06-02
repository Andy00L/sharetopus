// app/api/social/connect/instagram/route.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import { exchangeInstagramCode } from "@/lib/api/instagram/data/exchangeInstagramCode";
import { getInstagramProfile } from "@/lib/api/instagram/data/getInstagramProfile";

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

    // Récupérer le code et la state depuis l'URL
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    // En cas d'erreur retournée par Instagram
    if (error) {
      console.error(`Instagram OAuth error: ${error} - ${errorDescription}`);
      return new Response(
        `
        <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Connection Failed</title>
    <script>
      if (window.opener) {
        window.opener.onInstagramConnectFailure("${errorDescription ?? error}");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>Instagram connection failed. This window will close automatically.</p>
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

    const storedState = (await cookies()).get("instagram_auth_state")?.value;

    // Verify state matches to prevent CSRF attacks
    if (!state || !storedState || state !== storedState) {
      return new Response(
        `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Security Verification Failed</title>
    <script>
      if (window.opener) {
        window.opener.onInstagramConnectFailure("Security verification failed");
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
    (await cookies()).delete("instagram_auth_state");

    // Vérifier la présence du code
    if (!code) {
      return new Response(
        `
        <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Missing Parameters</title>
    <script>
      if (window.opener) {
        window.opener.onInstagramConnectFailure("Missing authorization code");
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

    // Échanger le code contre un token
    const tokenResponse = await exchangeInstagramCode(code);

    if (!tokenResponse?.access_token) {
      return new Response(
        `
       <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Token Exchange Failed</title>
    <script>
      if (window.opener) {
        window.opener.onInstagramConnectFailure("Token exchange failure");
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

    // Récupérer les informations du profil Instagram
    const instagramProfile = await getInstagramProfile(
      tokenResponse.access_token,
      tokenResponse.user_id
    );

    // Préparer les données supplémentaires à stocker
    const extraData = {
      scope:
        tokenResponse.scope ||
        "instagram_business_basic,instagram_business_content_publish",
      account_type: instagramProfile.account_type,
      media_count: instagramProfile.media_count,
    };

    // Enregistrer le compte Instagram dans la base de données
    const { data: existingAccount, error: fetchError } = await adminSupabase
      .from("social_accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("account_identifier", instagramProfile.id)
      .eq("platform", "instagram")
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      // PGRST116 signifie "pas de ligne trouvée", ce qui est attendu si le compte n'existe pas encore
      console.error(
        "Error checking for existing Instagram account:",
        fetchError
      );
      return new Response(
        `
        <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Database Error</title>
    <script>
      if (window.opener) {
        window.opener.onInstagramConnectFailure("Database error");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>Error while verifying the account. This window will close automatically.</p>
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

    // Calculer la date d'expiration du token (Instagram tokens last 60 days by default)
    const expiresInSeconds = tokenResponse.expires_in ?? 5184000; // 60 days default
    const expiresAt = new Date(
      Date.now() + expiresInSeconds * 1000
    ).toISOString();

    // Si le compte existe déjà, mettre à jour les informations
    if (existingAccount) {
      const { error: updateError } = await adminSupabase
        .from("social_accounts")
        .update({
          username: instagramProfile.username,
          display_name: instagramProfile.name || instagramProfile.username,
          avatar_url: instagramProfile.profile_picture_url,
          is_availble: true,
          access_token: tokenResponse.access_token,
          refresh_token: null, // Instagram API with Instagram Login doesn't provide refresh tokens
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
          extra: extraData,
        })
        .eq("id", existingAccount.id);

      if (updateError) {
        console.error("Error updating Instagram account:", updateError);
        return new Response(
          `
         <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Update Error</title>
    <script>
      if (window.opener) {
        window.opener.onInstagramConnectFailure("Error updating Instagram account");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>Error updating the account. This window will close automatically.</p>
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
    } else {
      // Créer un nouveau compte
      const { error: insertError } = await adminSupabase
        .from("social_accounts")
        .insert({
          user_id: userId,
          platform: "instagram",
          account_identifier: instagramProfile.id,
          is_availble: true,
          username: instagramProfile.username,
          display_name: instagramProfile.name || instagramProfile.username,
          avatar_url: instagramProfile.profile_picture_url,
          access_token: tokenResponse.access_token,
          refresh_token: null, // Instagram API with Instagram Login doesn't use refresh tokens
          token_expires_at: expiresAt,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          extra: extraData,
        });

      if (insertError) {
        console.error("Error inserting Instagram account:", insertError);
        return new Response(
          `
          <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Creation Error</title>
    <script>
      if (window.opener) {
        window.opener.onInstagramConnectFailure("Error creating Instagram account");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>Error creating the account. This window will close automatically.</p>
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

    // Retourner une page HTML avec un script pour communiquer avec la fenêtre parent et fermer la popup
    return new Response(
      `
      <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Connection Successful</title>
    <script>
      if (window.opener) {
        window.opener.onInstagramConnectSuccess();
        window.close();
      }
    </script>
  </head>
  <body>
    <p>Instagram account successfully connected. This window will close automatically.</p>
  </body>
</html>
      `,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html",
        },
      }
    );
  } catch (error) {
    console.error("Unexpected error in Instagram auth callback:", error);
    return new Response(
      `
      <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Unexpected Error</title>
    <script>
      if (window.opener) {
        window.opener.onInstagramConnectFailure("An unexpected error occurred");
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
