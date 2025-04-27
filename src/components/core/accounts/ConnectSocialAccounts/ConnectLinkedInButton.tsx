// components/core/accounts/ConnectLinkedInButton.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

declare global {
  interface Window {
    onLinkedInConnectSuccess?: () => void;
    onLinkedInConnectFailure?: (error?: string) => void;
  }
}

function generateState(length = 32): string {
  const charset =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    result += charset[randomIndex];
  }
  return result;
}

export default function ConnectLinkedInButton() {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);

  // Use refs to maintain references across renders
  const popupRef = useRef<Window | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Define required scopes for LinkedIn
  // openid, profile, email pour les infos de profil
  // w_member_social pour pouvoir publier sur LinkedIn
  const scopes = [
    "openid",
    "profile",
    "email",
    "w_member_social",
    "offline_access",
  ].join(" ");

  // Clear inactivity timeout
  const clearInactivityTimeout = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Clear monitoring interval
  const clearPopupCheckInterval = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Comprehensive cleanup function
  const cleanupAuthFlow = () => {
    clearInactivityTimeout();
    clearPopupCheckInterval();

    // Close popup if it's still open
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }

    popupRef.current = null;
    setIsConnecting(false);
  };

  // Check if popup is closed
  const checkPopupStatus = () => {
    // Clear any existing interval first
    clearPopupCheckInterval();

    // Set new interval to check popup status
    intervalRef.current = setInterval(() => {
      if (popupRef.current?.closed) {
        cleanupAuthFlow();
        toast.info("Processus de connexion annulé");
      }
    }, 1000);

    // Set a maximum timeout for the entire auth flow (10 minutes)
    timeoutRef.current = setTimeout(() => {
      cleanupAuthFlow();
      toast.error("La connexion a expiré en raison d'inactivité");
    }, 600000); // 10 minutes
  };

  // Function to handle success from popup
  const handleLinkedInSuccess = () => {
    toast.success("Compte LinkedIn connecté avec succès!");
    cleanupAuthFlow();
    router.refresh();
  };

  // Add failure handler
  const handleLinkedInFailure = (error?: string) => {
    console.error("LinkedIn connection failed:", error);
    toast.error(`Échec de la connexion au compte LinkedIn`);
    cleanupAuthFlow();
  };

  // Setup and cleanup for window event handlers
  useEffect(() => {
    window.onLinkedInConnectSuccess = handleLinkedInSuccess;
    window.onLinkedInConnectFailure = handleLinkedInFailure;

    return () => {
      window.onLinkedInConnectSuccess = undefined;
      window.onLinkedInConnectFailure = undefined;
      cleanupAuthFlow(); // Ensure cleanup on component unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Open LinkedIn popup with unique window name
  const openLinkedInPopup = () => {
    // Prevent multiple connection attempts
    if (isConnecting) return;

    try {
      setIsConnecting(true);

      // Generate new state token for this connection attempt
      const newState = generateState();

      // Store in sessionStorage for verification
      sessionStorage.setItem("linkedinAuthState", newState);

      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      // Get redirect URI from environment variables
      const redirectUri = process.env.NEXT_PUBLIC_LINKEDIN_REDIRECT_URL;

      if (!redirectUri) {
        throw new Error("LinkedIn redirect URL not configured");
      }

      // Create a unique window name using timestamp to prevent cache issues
      const uniqueWindowName = `LinkedInOAuth_${Date.now()}`;

      // LinkedIn OAuth URL - Documentation à cette URL:
      // https://www.linkedin.com/developers/apps/verification/authorization-code-flow
      const LINKEDIN_AUTH_URL = `https://www.linkedin.com/oauth/v2/authorization?client_id=${
        process.env.NEXT_PUBLIC_LINKEDIN_CLIENT_ID
      }&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&state=${newState}&response_type=code&prompt=login`;

      const popup = window.open(
        LINKEDIN_AUTH_URL,
        uniqueWindowName,
        `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
      );

      // Store the popup reference
      popupRef.current = popup;

      // Check if popup was blocked
      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        throw new Error(
          "La fenêtre de connexion a été bloquée par le navigateur"
        );
      }

      // Start monitoring popup status
      checkPopupStatus();
    } catch (error) {
      console.error("Error starting LinkedIn connection:", error);
      toast.error("Failed to start LinkedIn connection");
      setIsConnecting(false);
    }
  };

  return (
    <Button onClick={openLinkedInPopup} disabled={isConnecting}>
      {isConnecting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Connexion en cours...
        </>
      ) : (
        "Connecter un compte LinkedIn"
      )}
    </Button>
  );
}
