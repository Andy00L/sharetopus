"use client";

import { Button } from "@/components/ui/button";
import { PLATFORM_LABELS } from "@/lib/platforms/capabilities";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ConnectionLimitModal from "./ConnectionLimitModal";

/** Popup window dimensions, matching the older per-platform buttons. */
const POPUP_WIDTH_PX = 600;
const POPUP_HEIGHT_PX = 700;
/** Whole-flow inactivity timeout in milliseconds (10 minutes). */
const AUTH_FLOW_TIMEOUT_MS = 600_000;
/** Popup-closed poll interval in milliseconds. */
const POPUP_POLL_INTERVAL_MS = 1_000;

type ConnectablePlatform = "youtube" | "x" | "facebook";

type SuccessCallbackName =
  | "onYouTubeConnectSuccess"
  | "onXConnectSuccess"
  | "onFacebookConnectSuccess";
type FailureCallbackName =
  | "onYouTubeConnectFailure"
  | "onXConnectFailure"
  | "onFacebookConnectFailure";

declare global {
  interface Window {
    onYouTubeConnectSuccess?: () => void;
    onYouTubeConnectFailure?: (error?: string) => void;
    onXConnectSuccess?: () => void;
    onXConnectFailure?: (error?: string) => void;
    onFacebookConnectSuccess?: () => void;
    onFacebookConnectFailure?: (error?: string) => void;
  }
}

/**
 * Callback names must match the popup HTML emitted by the platform's
 * /api/social/<platform>/connect route (completeWebOAuthConnect config).
 */
const PLATFORM_CONNECT_CONFIGS: Record<
  ConnectablePlatform,
  {
    initiateEndpoint: string;
    successCallbackName: SuccessCallbackName;
    failureCallbackName: FailureCallbackName;
  }
> = {
  youtube: {
    initiateEndpoint: "/api/social/youtube/initiate",
    successCallbackName: "onYouTubeConnectSuccess",
    failureCallbackName: "onYouTubeConnectFailure",
  },
  x: {
    initiateEndpoint: "/api/social/x/initiate",
    successCallbackName: "onXConnectSuccess",
    failureCallbackName: "onXConnectFailure",
  },
  facebook: {
    initiateEndpoint: "/api/social/facebook/initiate",
    successCallbackName: "onFacebookConnectSuccess",
    failureCallbackName: "onFacebookConnectFailure",
  },
};

interface ConnectPlatformButtonProps {
  readonly platform: ConnectablePlatform;
  readonly canConnect?: boolean;
  readonly currentCount?: number;
  readonly maxAllowed?: number;
}

/**
 * Generic OAuth-popup connect button, parameterized by platform. The four
 * older platforms (tiktok, pinterest, linkedin, instagram) predate it and
 * keep their per-platform button files; new platforms use this one.
 */
export default function ConnectPlatformButton({
  platform,
  canConnect,
  currentCount,
  maxAllowed,
}: ConnectPlatformButtonProps) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);

  const config = PLATFORM_CONNECT_CONFIGS[platform];
  const platformLabel = PLATFORM_LABELS[platform];

  const popupRef = useRef<Window | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearInactivityTimeout = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const clearPopupCheckInterval = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const cleanupAuthFlow = () => {
    clearInactivityTimeout();
    clearPopupCheckInterval();
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
    setIsConnecting(false);
  };

  const watchPopupUntilClosedOrTimedOut = () => {
    clearPopupCheckInterval();
    intervalRef.current = setInterval(() => {
      if (popupRef.current?.closed) {
        cleanupAuthFlow();
        toast.info("Connection process cancelled");
      }
    }, POPUP_POLL_INTERVAL_MS);

    timeoutRef.current = setTimeout(() => {
      cleanupAuthFlow();
      toast.error("The connection timed out due to inactivity");
    }, AUTH_FLOW_TIMEOUT_MS);
  };

  const handleConnectSuccess = () => {
    toast.success(`${platformLabel} account connected successfully!`);
    cleanupAuthFlow();
    router.refresh();
  };

  const handleConnectFailure = (error?: string) => {
    console.error(`[ConnectPlatformButton] ${platform} connection failed:`, error);
    toast.error(`Failed to connect the ${platformLabel} account`);
    cleanupAuthFlow();
  };

  // External system sync: the OAuth popup reports back through
  // window.opener globals, which React does not own. Register them for
  // the component's lifetime and clean up on unmount.
  useEffect(() => {
    window[config.successCallbackName] = handleConnectSuccess;
    window[config.failureCallbackName] = handleConnectFailure;

    return () => {
      window[config.successCallbackName] = undefined;
      window[config.failureCallbackName] = undefined;
      cleanupAuthFlow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, platform]);

  const handleButtonClick = () => {
    if (!canConnect) {
      setShowLimitModal(true);
    } else {
      openConnectPopup();
    }
  };

  const openConnectPopup = async () => {
    if (isConnecting || !canConnect) return;

    try {
      setIsConnecting(true);

      // Open a blank popup immediately (inside the user gesture) so the
      // browser does not block it, then navigate it to the auth URL.
      const popupLeft = window.screen.width / 2 - POPUP_WIDTH_PX / 2;
      const popupTop = window.screen.height / 2 - POPUP_HEIGHT_PX / 2;
      const uniqueWindowName = `${platform}OAuth_${Date.now()}`;

      const popup = window.open(
        "about:blank",
        uniqueWindowName,
        `width=${POPUP_WIDTH_PX},height=${POPUP_HEIGHT_PX},top=${popupTop},left=${popupLeft},scrollbars=yes`,
      );
      popupRef.current = popup;

      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        toast.error("The connection window was blocked by the browser");
        setIsConnecting(false);
        return;
      }

      const response = await fetch(config.initiateEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        popup.close();
        toast.error(
          data.message ?? `Failed to start the ${platformLabel} connection`,
        );
        setIsConnecting(false);
        return;
      }

      popup.location.href = data.authUrl;
      watchPopupUntilClosedOrTimedOut();
    } catch (error) {
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
      console.error(
        `[ConnectPlatformButton] Error starting ${platform} connection:`,
        error,
      );
      toast.error(`Failed to start the ${platformLabel} connection`);
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
          `Connect a ${platformLabel} account`
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
