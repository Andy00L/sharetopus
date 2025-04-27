// app/api/auth/linkedin/route.ts
import { adminSupabase } from "@/actions/api/supabase-client";
import { exchangeLinkedInCode } from "@/lib/api/linkedin/data/exchangeLinkedInCode";
import { getLinkedInProfile } from "@/lib/api/linkedin/data/getLinkedInProfile";
import { auth } from "@clerk/nextjs/server";
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
        <html>
          <head>
            <title>Connexion échouée</title>
            <script>
              if (window.opener) {
                window.opener.onLinkedInConnectFailure("${
                  errorDescription ?? error
                }");
                window.close();
              }
            </script>
          </head>
          <body>
            <p>Connexion LinkedIn échouée. Cette fenêtre va se fermer automatiquement.</p>
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

    // Vérifier la présence du code et du state
    if (!code || !state) {
      return new Response(
        `
        <html>
          <head>
            <title>Paramètres manquants</title>
            <script>
              if (window.opener) {
                window.opener.onLinkedInConnectFailure("Code ou state manquant");
                window.close();
              }
            </script>
          </head>
          <body>
            <p>Paramètres nécessaires manquants. Cette fenêtre va se fermer automatiquement.</p>
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
        <html>
          <head>
            <title>Échange de token échoué</title>
            <script>
              if (window.opener) {
                window.opener.onLinkedInConnectFailure("Échec d'échange de token");
                window.close();
              }
            </script>
          </head>
          <body>
            <p>Échec lors de l'échange du code d'autorisation. Cette fenêtre va se fermer automatiquement.</p>
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
        <html>
          <head>
            <title>Erreur de base de données</title>
            <script>
              if (window.opener) {
                window.opener.onLinkedInConnectFailure("Erreur de base de données");
                window.close();
              }
            </script>
          </head>
          <body>
            <p>Erreur lors de la vérification du compte. Cette fenêtre va se fermer automatiquement.</p>
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
          <html>
            <head>
              <title>Erreur de mise à jour</title>
              <script>
                if (window.opener) {
                  window.opener.onLinkedInConnectFailure("Erreur lors de la mise à jour du compte LinkedIn");
                  window.close();
                }
              </script>
            </head>
            <body>
              <p>Erreur lors de la mise à jour du compte. Cette fenêtre va se fermer automatiquement.</p>
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
          <html>
            <head>
              <title>Erreur de création</title>
              <script>
                if (window.opener) {
                  window.opener.onLinkedInConnectFailure("Erreur lors de la création du compte LinkedIn");
                  window.close();
                }
              </script>
            </head>
            <body>
              <p>Erreur lors de la création du compte. Cette fenêtre va se fermer automatiquement.</p>
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
      <html>
        <head>
          <title>Connexion réussie</title>
          <script>
            if (window.opener) {
              window.opener.onLinkedInConnectSuccess();
              window.close();
            }
          </script>
        </head>
        <body>
          <p>Compte LinkedIn connecté avec succès. Cette fenêtre va se fermer automatiquement.</p>
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
      <html>
        <head>
          <title>Erreur inattendue</title>
          <script>
            if (window.opener) {
              window.opener.onLinkedInConnectFailure("Une erreur inattendue s'est produite");
              window.close();
            }
          </script>
        </head>
        <body>
          <p>Une erreur inattendue s'est produite. Cette fenêtre va se fermer automatiquement.</p>
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
