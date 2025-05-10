// components/core/accounts/ConnectLinkedInButton.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ConnectionLimitModal from "./ConnectionLimitModal";

declare global {
  interface Window {
    onLinkedInConnectSuccess?: () => void;
    onLinkedInConnectFailure?: (error?: string) => void;
  }
}
// Properly define component props
interface ConnectLinkedInButtonProps {
  readonly canConnect?: boolean;
  readonly currentCount?: number;
  readonly maxAllowed?: number;
}
export default function ConnectLinkedInButton({
  canConnect,
  currentCount,
  maxAllowed,
}: ConnectLinkedInButtonProps) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);

  // Use refs to maintain references across renders
  const popupRef = useRef<Window | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

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
  const handleLinkedInFailure = () => {
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

  // Handle button click - either start auth flow or show limit modal
  const handleButtonClick = () => {
    if (!canConnect) {
      setShowLimitModal(true);
    } else {
      openLinkedInPopup();
    }
  };

  // Open LinkedIn popup with unique window name
  const openLinkedInPopup = async () => {
    if (isConnecting || !canConnect) return;
    try {
      setIsConnecting(true);

      // Open blank popup IMMEDIATELY (during user click)
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      const uniqueWindowName = `LinkedInOAuth_${Date.now()}`;
      const popup = window.open(
        "about:blank", // Start with blank page
        uniqueWindowName,
        `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
      );

      // Store reference
      popupRef.current = popup;

      // Check if popup was blocked
      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        toast.error("La fenêtre de connexion a été bloquée par le navigateur");
        setIsConnecting(false);
        return;
      }

      // THEN fetch the auth URL
      const response = await fetch("/api/social/initiate/linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        popup.close();
        toast.error(data.message ?? "Failed to start LinkedIn connection");
        setIsConnecting(false);
        return;
      }

      // Update the popup's location to the auth URL
      popup.location.href = data.authUrl;

      // Start monitoring popup status
      checkPopupStatus();
    } catch (error) {
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }

      console.error("Error starting LinkedIn connection:", error);
      toast.error(`Failed to start LinkedIn connection`);
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
            <Loader2 className="mr-2 h-4 w-4 animate-spin " />
            Connecting....
          </>
        ) : (
          "Connect a LinkedIn account"
        )}
      </Button>
      <ConnectionLimitModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        currentCount={currentCount!}
        maxAllowed={maxAllowed!}
      />
    </>
  );
}
