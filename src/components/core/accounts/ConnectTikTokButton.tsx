// components/ConnectTikTokButton.tsx
"use client";

import { Button } from "@/components/ui/button";

// Function to generate a random state (for CSRF prevention)
function generateState(length = 16): string {
  const charset =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    result += charset[randomIndex];
  }
  return result;
}

export default function ConnectTikTokButton() {
  // Generate a state token
  const state = generateState();

  // Define the required scopes
  const scopes = "user.info.basic,video.publish,video.upload";

  // Construct the proper redirect URI and OAuth URL using the v2 endpoint.
  const redirectUri = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL ?? ""; // Make sure this value exactly matches what you registered, e.g. "https://sharetopus.com/api/social/connect/tiktok/"

  const TIKTOK_AUTH_URL = `https://www.tiktok.com/v2/auth/authorize/?client_key=${
    process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY
  }&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${state}&response_type=code`;

  const openTikTokPopup = () => {
    const width = 600;
    const height = 600;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    window.open(
      TIKTOK_AUTH_URL,
      "TikTokOAuth",
      `width=${width},height=${height},top=${top},left=${left}`
    );
  };

  return <Button onClick={openTikTokPopup}>Connecter un compte TikTok</Button>;
}
