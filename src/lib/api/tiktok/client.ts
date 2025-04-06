// lib/api/tiktok/client.ts
export interface TikTokProfile {
  id: string; // par exemple l’open_id de TikTok
  username: string;
  // Vous pouvez ajouter d’autres champs (nom affiché, image, etc.) selon les besoins
}

export async function getTikTokProfile(
  accessToken: string
): Promise<TikTokProfile> {
  // URL de récupération des informations utilisateur de TikTok.
  // Vérifiez la documentation officielle de TikTok pour l’endpoint exact.
  const url = "https://open-api.tiktok.com/user/info/";
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error("Erreur lors de la récupération du profil TikTok: " + text);
  }

  const data = await res.json();
  // On suppose ici que la réponse est de la forme { data: { open_id, display_name, ... } }
  if (data?.data) {
    return {
      id: data.data.open_id,
      username: data.data.display_name,
    };
  } else {
    throw new Error(
      "Réponse invalide lors de la récupération du profil TikTok."
    );
  }
}
