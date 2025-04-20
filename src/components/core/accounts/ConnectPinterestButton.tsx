// components/core/accounts/ConnectPinterestButton.tsx
"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

declare global {
  interface Window {
    onPinterestConnectSuccess?: () => void;
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

export default function ConnectPinterestButton() {
  const router = useRouter();

  // Define required scopes
  const scopes = [
    "boards:read",
    "boards:write",
    "pins:read",
    "pins:write",
    "user_accounts:read",
    "catalogs:read",
    "catalogs:write",
  ].join(",");
  // Generate a state token
  const state = generateState();

  // Function to handle success from popup
  const handlePinterestSuccess = () => {
    console.log("Pinterest connection successful, refreshing page...");
    router.refresh();
  };

  // Setup and cleanup for window event handlers
  useEffect(() => {
    window.onPinterestConnectSuccess = handlePinterestSuccess;

    return () => {
      window.onPinterestConnectSuccess = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Open Pinterest popup with unique window name
  const openPinterestPopup = () => {
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    // Get redirect URI
    const redirectUri = process.env.NEXT_PUBLIC_PINTEREST_REDIRECT_URL ?? "";

    // Create a unique window name using timestamp
    const uniqueWindowName = `PinterestOAuth_${Date.now()}`;

    // Add prompt=login parameter to force fresh login
    const PINTEREST_AUTH_URL = `https://www.pinterest.com/oauth/?client_id=${
      process.env.NEXT_PUBLIC_PINTEREST_CLIENT_ID
    }&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${state}&response_type=code&prompt=login`;

    window.open(
      PINTEREST_AUTH_URL,
      uniqueWindowName,
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
    );
  };

  return (
    <Button onClick={openPinterestPopup}>Connecter un compte Pinterest</Button>
  );
}
