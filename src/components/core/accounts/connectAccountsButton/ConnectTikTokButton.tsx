// components/ConnectTikTokButton.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ConnectionLimitModal from "./ConnectionLimitModal";

declare global {
  interface Window {
    onTikTokConnectSuccess?: () => void;
    onTikTokConnectFailure?: (error?: string) => void;
  }
}

// Properly define component props
interface ConnectTikTokButtonProps {
  readonly canConnect?: boolean;
  readonly currentCount?: number;
  readonly maxAllowed?: number;
}

export default function ConnectTikTokButton({
  canConnect,
  currentCount,
  maxAllowed,
}: ConnectTikTokButtonProps) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);

  // Use refs to maintain references across renders
  const popupRef = useRef<Window | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clear any active timeouts
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

  // Monitor popup status
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

    // Set a maximum timeout for the entire auth flow (8 minutes)
    timeoutRef.current = setTimeout(() => {
      cleanupAuthFlow();
      toast.error("La connexion a expiré en raison d'inactivité");
    }, 480000); // 8 minutes
  };

  // Function to handle success from popup
  const handleTikTokSuccess = () => {
    toast.success("Compte TikTok connecté avec succès!");
    cleanupAuthFlow();
    router.refresh();
  };

  // Add failure handler
  const handleTikTokFailure = (error?: string) => {
    console.error("TikTok connection failed:", error);
    toast.error("Échec de la connexion au compte TikTok");
    cleanupAuthFlow();
  };

  // Setup and cleanup for window event handlers
  useEffect(() => {
    window.onTikTokConnectSuccess = handleTikTokSuccess;
    window.onTikTokConnectFailure = handleTikTokFailure;

    return () => {
      window.onTikTokConnectSuccess = undefined;
      window.onTikTokConnectFailure = undefined;
      cleanupAuthFlow(); // Ensure cleanup on component unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);
  // Handle button click - either start auth flow or show limit modal
  const handleButtonClick = () => {
    if (!canConnect) {
      setShowLimitModal(true);
    } else {
      openTikTokPopup();
    }
  };
  // Open TikTok popup with security measures
  const openTikTokPopup = async () => {
    // Prevent multiple connection attempts
    if (isConnecting || !canConnect) return;

    try {
      setIsConnecting(true);

      // Open blank popup IMMEDIATELY during user click
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      const uniqueWindowName = `TikTokOAuth_${Date.now()}`;

      // Open a blank popup right away to preserve the user gesture connection
      const popup = window.open(
        "about:blank", // Start with blank page
        uniqueWindowName,
        `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
      );

      // Store reference to popup
      popupRef.current = popup;

      // Check if popup was blocked
      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        toast.error("La fenêtre de connexion a été bloquée par le navigateur");
        setIsConnecting(false);
        return;
      }

      // THEN fetch the auth URL
      const response = await fetch("/api/social/tiktok/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        // Close the popup if there was an error
        popup.close();
        toast.error(data.message ?? "Failed to start TikTok connection");
        setIsConnecting(false);
        return;
      }

      // Update the popup's location to the auth URL
      popup.location.href = data.authUrl;

      // Start monitoring popup status
      checkPopupStatus();
    } catch (error) {
      // Close the popup if there was an error
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }

      console.error("Error starting TikTok connection:", error);
      toast.error("Failed to start TikTok connection");
      setIsConnecting(false);
    }
  };
  return (
    <>
      <Button
        onClick={handleButtonClick}
        disabled={isConnecting}
        className="cursor-pointer"
      >
        {isConnecting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Connecting...
          </>
        ) : (
          "Connect a Tiktok account"
        )}
      </Button>{" "}
      <ConnectionLimitModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        currentCount={currentCount!}
        maxAllowed={maxAllowed!}
      />
    </>
  );
}
