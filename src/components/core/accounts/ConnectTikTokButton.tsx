// components/ConnectTikTokButton.tsx
"use client";

import { Button } from "@/components/ui/button";

export default function ConnectTikTokButton() {
  // Construction de l'URL OAuth en utilisant vos variables d'environnement.
  // L'URL de redirection pointe ici vers votre endpoint d'échange.
  const TIKTOK_AUTH_URL = `https://www.tiktok.com/auth/authorize?client_key=${process.env.TIKTOK_CLIENT_KEY}&redirect_uri=${process.env.NEXT_PUBLIC_APP_URL}/api/social/connect/tiktok/route&response_type=code`;

  const openTikTokPopup = () => {
    const width = 600;
    const height = 600;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    // Ouvrir la pop-up sans stocker la référence, puisqu'elle n'est pas utilisée par la suite.
    window.open(
      TIKTOK_AUTH_URL,
      "TikTokOAuth",
      `width=${width},height=${height},top=${top},left=${left}`
    );
  };

  return <Button onClick={openTikTokPopup}>Connecter un compte TikTok</Button>;
}
