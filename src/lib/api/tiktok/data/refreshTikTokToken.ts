import { TokenExchangeResponse } from "@/lib/types/dbTypes";

/**
 * Rafraîchit un token TikTok expiré
 */
export default async function refreshTikTokToken(
  refreshToken: string
): Promise<TokenExchangeResponse | null> {
  const clientKey = process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    console.error("[TikTok Refresh Token] Configuration manquante");
    return null;
  }

  try {
    console.log(
      "[TikTok Refresh Token] Tentative de rafraîchissement du token"
    );

    const url = "https://open.tiktokapis.com/v2/oauth/token/";

    const params = new URLSearchParams();
    params.append("client_key", clientKey);
    params.append("client_secret", clientSecret);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);

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
        `[Tiktok  Refresh Token] Échec du rafraîchissement (${response.status}): ${errorText}`
      );
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.error(
        `[Tiktok  Refresh Token] Erreur TikTok: ${JSON.stringify(data.error)}`
      );
    }

    if (!data.access_token) {
      console.error(
        `[Tiktok  Refresh Token] Champs obligatoires manquants: ${JSON.stringify(
          data
        )}`
      );
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_in: data.expires_in,
    } as TokenExchangeResponse;
  } catch (error) {
    console.error("[TikTok] Erreur:", error);
    return null;
  }
}
