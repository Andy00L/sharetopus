// lib/api/auth/ensureValidToken.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import { SocialAccount, TokenExchangeResponse } from "@/lib/types/dbTypes";
import refreshLinkedInToken from "./linkedin/data/refreshLinkedinToken";
import refreshPinterestToken from "./pinterest/data/refreshPinterestToken";
import refreshTikTokToken from "./tiktok/data/refreshTikTokToken";

/**
 * Vérifie et rafraîchit si nécessaire un token pour n'importe quelle plateforme
 * @param account Le compte social
 * @returns Un access_token valide ou null en cas d'échec
 */
export async function ensureValidToken(
  account: SocialAccount
): Promise<string | null> {
  // Vérifier si nous avons un token d'accès
  if (!account.access_token) {
    console.error(
      `[ensureValidToken] Pas de token d'accès pour ${account.platform}`
    );
    return null;
  }

  // Vérifier si le token est expiré ou sur le point d'expirer
  const isExpired = isTokenExpired(account.token_expires_at);

  // Si le token est valide, on le retourne directement
  if (!isExpired) {
    return account.access_token;
  }

  console.log(
    `[ensureValidToken ${account.platform}] Token expiré ou proche de l'expiration, rafraîchissement...`
  );

  // Vérifier si nous avons un refresh token
  if (!account.refresh_token) {
    console.error(
      `[ensureValidToken. ${account.platform}] Pas de refresh token disponible`
    );
    return null;
  }

  try {
    // Appeler la fonction de rafraîchissement appropriée selon la plateforme
    let newTokens: TokenExchangeResponse | null = null;

    switch (account.platform) {
      case "tiktok":
        newTokens = await refreshTikTokToken(account.refresh_token);
        break;
      case "pinterest":
        newTokens = await refreshPinterestToken(account.refresh_token);
        break;
      case "linkedin":
        newTokens = await refreshLinkedInToken(account.refresh_token);
        break;
      default:
        console.error(
          `[ensureValidToken] Plateforme non supportée: ${account.platform}`
        );
        return null;
    }

    if (!newTokens) {
      console.error(
        `[ensureValidToken ${account.platform}] Échec du rafraîchissement`
      );
      return null;
    }

    // Mettre à jour les tokens dans la base de données
    const updateSuccess = await updateTokenInDatabase(
      account.id,
      account.platform,
      newTokens
    );

    if (!updateSuccess) {
      console.error(
        `[ensureValidToken ${account.platform}] Échec de la mise à jour en base de données`
      );
      // On peut retourner le nouveau token même si la mise à jour a échoué
      return newTokens.access_token;
    }

    console.log(
      `[ensureValidToken ${account.platform}] Token rafraîchi avec succès`
    );
    return newTokens.access_token;
  } catch (error) {
    console.error(
      `[${account.platform}] Erreur lors du rafraîchissement:`,
      error
    );
    return null;
  }
}

/**
 * Vérifie si un token est expiré ou expire dans les 5 minutes
 * @param expiresAt Date d'expiration du token au format ISO string
 * @returns true si expiré ou proche de l'expiration, false sinon
 */
function isTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;

  const now = new Date();
  const expiry = new Date(expiresAt);

  // Ajouter une marge de 5 minutes pour éviter les problèmes à la limite
  const bufferTime = 5 * 60 * 1000; // 5 minutes en millisecondes

  return now.getTime() + bufferTime >= expiry.getTime();
}

/**
 * Met à jour les informations de token pour un compte social
 * @param accountId ID du compte social dans la base de données
 * @param platform Type de plateforme (tiktok, pinterest, etc.)
 * @param tokenData Données du nouveau token
 * @returns Succès ou échec de la mise à jour
 */
async function updateTokenInDatabase(
  accountId: string,
  platform: string,
  tokenData: TokenExchangeResponse
): Promise<boolean> {
  try {
    console.log(
      `[ensureValidToken ${platform}] Mise à jour des tokens pour le compte ${accountId}`
    );

    // Calculer la date d'expiration du token
    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokenData.expires_in * 1000);

    // Mettre à jour les tokens et la date d'expiration dans la base de données
    const { error } = await adminSupabase
      .from("social_accounts")
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null, // Certains refreshs ne retournent pas un nouveau refresh_token
        token_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", accountId)
      .eq("platform", platform);

    if (error) {
      console.error(
        `[ensureValidToken ${platform}] Erreur de mise à jour:`,
        error
      );
      return false;
    }

    console.log(
      `[ensureValidToken ${platform}] Tokens mis à jour avec succès pour ${accountId}`
    );
    return true;
  } catch (error) {
    console.error(`[ensureValidToken ${platform}] Erreur:`, error);
    return false;
  }
}
