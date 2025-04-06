// lib/api/tiktok/auth.ts
export interface TokenExchangeResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // durée en secondes avant expiration
}

export async function exchangeTikTokCode(
  code: string
): Promise<TokenExchangeResponse> {
  // Récupération de la configuration depuis les variables d’environnement
  const client_id = process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY;
  // Nous ne transmettons pas le client_secret pour le flow web (cela peut causer des erreurs)
  const redirect_uri = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;
  if (!client_id || !redirect_uri) {
    throw new Error("Configuration TikTok manquante.");
  }

  // URL de l'endpoint d'échange (sans trailing slash)
  const url = "https://open-api.tiktok.com/oauth/access_token";
  const params = new URLSearchParams();
  params.append("client_key", client_id);
  params.append("code", code);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", redirect_uri);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error("Erreur lors de l'échange du code: " + text);
  }

  const data = await res.json();
  if (data?.data) {
    return data.data as TokenExchangeResponse;
  } else {
    throw new Error("Réponse invalide lors de l'échange du code TikTok.");
  }
}
