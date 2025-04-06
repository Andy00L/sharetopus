// lib/api/tiktok/auth.ts
export interface TokenExchangeResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
  token_type: string;
}

export async function exchangeTikTokCode(
  code: string
): Promise<TokenExchangeResponse> {
  // Récupération de la configuration depuis les variables d’environnement
  const client_id = process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY;
  const client_secret = process.env.TIKTOK_CLIENT_SECRET;
  const redirect_uri = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;
  if (!client_id || !client_secret || !redirect_uri) {
    throw new Error("Configuration TikTok manquante.");
  }

  // Utilisation de l'endpoint mis à jour (attention à la barre oblique finale)
  const url = "https://open.tiktokapis.com/v2/oauth/token/";

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

  // La réponse attendue est directement la structure contenant les tokens.
  if (data && !data.error) {
    return data as TokenExchangeResponse;
  } else {
    throw new Error("Réponse invalide lors de l'échange du code TikTok.");
  }
}
