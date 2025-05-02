import { TokenExchangeResponse } from "@/lib/types/dbTypes";

/**
 * Rafraîchit un token LinkedIn expiré
 */
export default async function refreshLinkedInToken(
  refreshToken: string
): Promise<TokenExchangeResponse | null> {
  const clientId = process.env.NEXT_PUBLIC_LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[LinkedIn Refresh Token] Configuration manquante");
    return null;
  }

  try {
    console.log(
      "[LinkedIn Refresh Token] Tentative de rafraîchissement du token"
    );

    const url = "https://www.linkedin.com/oauth/v2/accessToken";

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
      console.log(
        `[LinkedIn  Refresh Token] Échec du rafraîchissement (${response.status}): ${errorText}`
      );
      return null;
    }

    const data = await response.json();

    if (!data.access_token) {
      console.log(
        `[LinkedIn  Refresh Token] Champs obligatoires manquants: ${JSON.stringify(
          data
        )}`
      );
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_in: data.expires_in || 7200, // 2 heures par défaut
    } as TokenExchangeResponse;
  } catch (error) {
    console.error("[LinkedIn  Refresh Token] Erreur:", error);
    return null;
  }
}
