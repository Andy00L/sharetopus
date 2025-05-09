import { TokenExchangeResponse } from "@/lib/types/dbTypes";

/**
 * Rafraîchit un token Pinterest expiré
 */
export default async function refreshPinterestToken(
  refreshToken: string
): Promise<TokenExchangeResponse | null> {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[Pinterest  Refresh Token]  Configuration manquante");
    return null;
  }

  try {
    console.log(
      "[Pinterest  Refresh Token]  Tentative de rafraîchissement du token"
    );

    const url = "https://api.pinterest.com/v5/oauth/token";

    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);
    params.append("client_id", clientId);
    params.append("client_secret", clientSecret);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[Pinterest  Refresh Token] Échec du rafraîchissement (${response.status}): ${errorText}`
      );
      return null;
    }

    const data = await response.json();

    if (!data.access_token) {
      console.error(
        `[Pinterest  Refresh Token] Champs obligatoires manquants: ${JSON.stringify(
          data
        )}`
      );
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken, // Utiliser l'ancien si pas de nouveau
      expires_in: data.expires_in, // 30 jours par défaut
    } as TokenExchangeResponse;
  } catch (error) {
    console.error("[Pinterest  Refresh Token] Erreur:", error);
    return null;
  }
}
