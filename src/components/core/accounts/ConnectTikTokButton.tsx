// components/ConnectTikTokButton.tsx
"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

declare global {
  interface Window {
    onTikTokConnectSuccess?: () => void;
  }
}

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
  const router = useRouter();

  const scopes =
    "user.info.basic,user.info.profile,video.publish,video.upload,user.info.stats";

  // Generate a unique state token for security
  const state = generateState();

  // Function to handle success from popup
  const handleTikTokSuccess = () => {
    console.log("TikTok connection successful, refreshing page...");
    router.refresh();
  };

  // Setup and cleanup for window event handlers
  useEffect(() => {
    window.onTikTokConnectSuccess = handleTikTokSuccess;

    return () => {
      window.onTikTokConnectSuccess = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Open TikTok popup with unique window name and force_login parameter
  const openTikTokPopup = () => {
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    // Get the redirect URI from env
    const redirectUri = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL ?? "";

    // Create a unique window name using timestamp
    const uniqueWindowName = `TikTokOAuth_${Date.now()}`;

    // Add force_login=true to force a new login screen
    const TIKTOK_AUTH_URL = `https://www.tiktok.com/v2/auth/authorize/?client_key=${
      process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY
    }&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${state}&response_type=code&force_login=true`;

    window.open(
      TIKTOK_AUTH_URL,
      uniqueWindowName,
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
    );
  };

  return <Button onClick={openTikTokPopup}>Connecter un compte TikTok</Button>;
}
