// components/core/accounts/ConnectPinterestButton.tsx
"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react"; // Add useCallback import

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
  const scopes =
    "ads:read,boards:read,boards:read_secret,boards:write,boards:write_secret,pins:read,pins:read_secret,pins:write,pins:write_secret,user_accounts:read,catalogs:read,catalogs:write";

  // Generate a state token
  const state = generateState();

  // Construct the proper redirect URI and OAuth URL
  const redirectUri = process.env.NEXT_PUBLIC_PINTEREST_REDIRECT_URL ?? "";
  const PINTEREST_AUTH_URL = `https://www.pinterest.com/oauth/?client_id=${
    process.env.NEXT_PUBLIC_PINTEREST_CLIENT_ID
  }&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${state}&response_type=code`;

  // Use useCallback to memoize the function
  const handlePinterestSuccess = useCallback(() => {
    console.log("Pinterest connection successful, refreshing page...");
    router.refresh();
  }, [router]);

  // Now include handlePinterestSuccess in the dependency array
  useEffect(() => {
    window.onPinterestConnectSuccess = handlePinterestSuccess;

    return () => {
      window.onPinterestConnectSuccess = undefined;
    };
  }, [handlePinterestSuccess]);

  // Open Pinterest popup
  const openPinterestPopup = () => {
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    window.open(
      PINTEREST_AUTH_URL,
      "PinterestOAuth",
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
    );
  };

  return (
    <Button onClick={openPinterestPopup}>Connecter un compte Pinterest</Button>
  );
}
