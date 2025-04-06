// components/ConnectTikTokButton.tsx
"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation"; // Import useRouter
import { useEffect } from "react"; // Import useEffect

declare global {
  interface Window {
    // Declare the custom property and its type (a function returning void)
    // Make it optional as it won't always exist
    onTikTokConnectSuccess?: () => void;
  }
}

// Function to generate a random state (for CSRF prevention) - unchanged
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
  const router = useRouter(); // Get router instance

  // --- FIX: Add user.info.profile scope ---
  const scopes = "user.info.basic,user.info.profile,video.publish,video.upload"; // Added user.info.profile

  // Generate a state token - unchanged
  const state = generateState();

  // Construct the proper redirect URI and OAuth URL - unchanged
  const redirectUri = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL ?? "";
  const TIKTOK_AUTH_URL = `https://www.tiktok.com/v2/auth/authorize/?client_key=${
    process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY
  }&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${state}&response_type=code`;

  // --- ADD: Function to handle success from popup ---
  const handleTikTokSuccess = () => {
    console.log("TikTok connection successful, refreshing page...");
    router.refresh(); // Refresh the current route to fetch new data
  };

  // --- ADD: useEffect to attach/detach the handler to window ---
  useEffect(() => {
    // --- FIX: Remove 'as any' ---
    // Now TypeScript knows about this property on window
    window.onTikTokConnectSuccess = handleTikTokSuccess;

    return () => {
      // --- FIX: Remove 'as any' ---
      // You can delete it or set it to undefined for cleanup
      // delete window.onTikTokConnectSuccess;
      window.onTikTokConnectSuccess = undefined; // Often preferred
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]); // Dependency array might need adjustment based on full context

  // --- openTikTokPopup function - unchanged ---
  const openTikTokPopup = () => {
    const width = 600;
    const height = 700; // Slightly taller often needed for TikTok's UI
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    window.open(
      TIKTOK_AUTH_URL,
      "TikTokOAuth",
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes` // Added scrollbars
    );
  };

  return <Button onClick={openTikTokPopup}>Connecter un compte TikTok</Button>;
}
