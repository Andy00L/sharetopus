// app/api/auth/linkedin/route.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import { exchangeLinkedInCode } from "@/lib/api/linkedin/data/exchangeLinkedInCode";
import { getLinkedInProfile } from "@/lib/api/linkedin/data/getLinkedInProfile";
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

    // En cas d'erreur retournée par LinkedIn
    if (error) {
      console.error(`LinkedIn OAuth error: ${error} - ${errorDescription}`);
      return new Response(
        `
        <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Connection Failed</title>
    <script>
      if (window.opener) {
        window.opener.onLinkedInConnectFailure("${errorDescription ?? error}");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>LinkedIn connection failed. This window will close automatically.</p>
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
    const storedState = (await cookies()).get("linkedin_auth_state")?.value;

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
        window.opener.onLinkedInConnectFailure("Security verification failed");
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
    (
      await // Clear the state cookie immediately after verification
      cookies()
    ).delete("linkedin_auth_state");

    // Vérifier la présence du code et du state
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
        window.opener.onLinkedInConnectFailure("Missing code or state");
        window.close();
      }
    </script>
  </head>
  <body>
    <p>Necessary parameters are missing. This window will close automatically.</p>
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

    // Vérifier le state pour prévenir les attaques CSRF
    // Cette vérification devrait être implémentée en comparant avec un state stocké côté serveur
    // Pour simplifier, nous supposons que cette vérification est effectuée ailleurs

    // Échanger le code contre un token
    const tokenResponse = await exchangeLinkedInCode(code);

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
        window.opener.onLinkedInConnectFailure("Token exchange failure");
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

    // Récupérer les informations du profil LinkedIn
    const linkedInProfile = await getLinkedInProfile(
      tokenResponse.access_token
    );

    // Préparer les données supplémentaires à stocker
    const extraData = {
      scope: "w_member_social openid profile email",
      locale: linkedInProfile.locale,
      email_verified: linkedInProfile.email_verified,
    };

    // Enregistrer le compte LinkedIn dans la base de données
    const { data: existingAccount, error: fetchError } = await adminSupabase
      .from("social_accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("account_identifier", linkedInProfile.id)
      .eq("platform", "linkedin")
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      // PGRST116 signifie "pas de ligne trouvée", ce qui est attendu si le compte n'existe pas encore
      console.error(
        "Error checking for existing LinkedIn account:",
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
        window.opener.onLinkedInConnectFailure("Database error");
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

    // Calculer la date d'expiration du token
    const expiresInSeconds = tokenResponse.expires_in ?? 3600; // Par défaut 1 heure
    const expiresAt = new Date(
      Date.now() + expiresInSeconds * 1000
    ).toISOString();

    // Si le compte existe déjà, mettre à jour les informations
    if (existingAccount) {
      const { error: updateError } = await adminSupabase
        .from("social_accounts")
        .update({
          username: linkedInProfile.name,
          display_name: linkedInProfile.name,
          avatar_url: linkedInProfile.picture,
          is_availble: true,
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token ?? null,
          token_expires_at: expiresAt,
          email_address: linkedInProfile.email,
          updated_at: new Date().toISOString(),
          extra: extraData,
        })
        .eq("id", existingAccount.id);

      if (updateError) {
        console.error("Error updating LinkedIn account:", updateError);
        return new Response(
          `
         <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Update Error</title>
    <script>
      if (window.opener) {
        window.opener.onLinkedInConnectFailure("Error updating LinkedIn account");
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
          platform: "linkedin",
          account_identifier: linkedInProfile.id,
          is_availble: true,
          username: linkedInProfile.name,
          display_name: linkedInProfile.name,
          avatar_url: linkedInProfile.picture,
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token ?? null,
          token_expires_at: expiresAt,
          email_address: linkedInProfile.email,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          extra: extraData,
        });
      if (insertError) {
        console.error("Error inserting LinkedIn account:", insertError);
        return new Response(
          `
          <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Creation Error</title>
    <script>
      if (window.opener) {
        window.opener.onLinkedInConnectFailure("Error creating LinkedIn account");
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
        window.opener.onLinkedInConnectSuccess();
        window.close();
      }
    </script>
  </head>
  <body>
    <p>LinkedIn account successfully connected. This window will close automatically.</p>
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
    console.error("Unexpected error in LinkedIn auth callback:", error);
    return new Response(
      `
      <!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Unexpected Error</title>
    <script>
      if (window.opener) {
        window.opener.onLinkedInConnectFailure("An unexpected error occurred");
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
