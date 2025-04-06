// lib/api/tiktok/auth.ts
export interface TokenExchangeResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // durée en secondes avant expiration
  // Vous pouvez ajouter d'autres champs si TikTok renvoie plus de données.
}

export async function exchangeTikTokCode(
  code: string
): Promise<TokenExchangeResponse> {
  // Récupération de la configuration depuis les variables d’environnement
  const client_id = process.env.TIKTOK_CLIENT_ID;
  const client_secret = process.env.TIKTOK_CLIENT_SECRET;
  const redirect_uri = process.env.TIKTOK_REDIRECT_URI;
  if (!client_id || !client_secret || !redirect_uri) {
    throw new Error("Configuration TikTok manquante.");
  }

  // URL de l'endpoint d'échange de code de TikTok
  const url = "https://open-api.tiktok.com/oauth/access_token/";
  const params = new URLSearchParams();
  params.append("client_key", client_id);
  params.append("client_secret", client_secret);
  params.append("code", code);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", redirect_uri);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error("Erreur lors de l'échange du code: " + text);
  }

  const data = await res.json();
  // Supposons que TikTok renvoie une structure { data: { access_token, refresh_token, expires_in } }
  if (data?.data) {
    return data.data as TokenExchangeResponse;
  } else {
    throw new Error("Réponse invalide lors de l'échange du code TikTok.");
  }
}
