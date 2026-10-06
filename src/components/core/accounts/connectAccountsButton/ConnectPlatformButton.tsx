"use client";

import { Button } from "@/components/ui/button";
import { popupCallbackNames } from "@/lib/api/oauth/web/popupCallbackNames";
import { PLATFORM_LABELS, type PostingPlatform } from "@/lib/platforms/capabilities";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import ConnectionLimitModal from "./ConnectionLimitModal";

const POPUP_WIDTH_PX = 600;
const POPUP_HEIGHT_PX = 700;
/** Whole-flow inactivity timeout (10 minutes). */
const AUTH_FLOW_TIMEOUT_MS = 600_000;
const POPUP_POLL_INTERVAL_MS = 1_000;

declare global {
  interface Window {
    [successCallback: `on${string}ConnectSuccess`]: (() => void) | undefined;
    [failureCallback: `on${string}ConnectFailure`]:
      | ((error?: string) => void)
      | undefined;
  }
}

interface ConnectPlatformButtonProps {
  readonly platform: PostingPlatform;
  readonly canConnect: boolean;
  readonly currentCount: number;
  readonly maxAllowed: number;
}

/** Opens the platform's OAuth popup, or the limit modal when the plan is full. */
export default function ConnectPlatformButton({
  platform,
  canConnect,
  currentCount,
  maxAllowed,
}: ConnectPlatformButtonProps) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const platformLabel = PLATFORM_LABELS[platform];

  const popupRef = useRef<Window | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const stopWatchingPopup = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const cleanupAuthFlow = () => {
    stopWatchingPopup();
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
    setIsConnecting(false);
  };

  const watchPopupUntilClosedOrTimedOut = () => {
    stopWatchingPopup();
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

  const handlePopupSuccess = useEffectEvent(() => {
    toast.success(`${platformLabel} account connected successfully!`);
    cleanupAuthFlow();
    router.refresh();
  });

  const handlePopupFailure = useEffectEvent((error?: string) => {
    console.error(`[ConnectPlatformButton] ${platform} connection failed:`, error);
    toast.error(`Failed to connect the ${platformLabel} account`);
    cleanupAuthFlow();
  });

  const cleanupOnUnmount = useEffectEvent(() => cleanupAuthFlow());

  // The OAuth popup reports back through window.opener globals, which React does not own.
  useEffect(() => {
    const callbackNames = popupCallbackNames(platform);
    window[callbackNames.success] = () => handlePopupSuccess();
    window[callbackNames.failure] = (error) => handlePopupFailure(error);

    return () => {
      window[callbackNames.success] = undefined;
      window[callbackNames.failure] = undefined;
      cleanupOnUnmount();
    };
  }, [platform]);

  const openConnectPopup = async () => {
    if (isConnecting) return;

    try {
      setIsConnecting(true);

      // Open the popup inside the click so the browser does not block it, then navigate it.
      const popupLeft = window.screen.width / 2 - POPUP_WIDTH_PX / 2;
      const popupTop = window.screen.height / 2 - POPUP_HEIGHT_PX / 2;
      const popup = window.open(
        "about:blank",
        `${platform}OAuth_${Date.now()}`,
        `width=${POPUP_WIDTH_PX},height=${POPUP_HEIGHT_PX},top=${popupTop},left=${popupLeft},scrollbars=yes`,
      );
      popupRef.current = popup;

      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        toast.error("The connection window was blocked by the browser");
        setIsConnecting(false);
        return;
      }

      const response = await fetch(`/api/social/${platform}/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        popup.close();
        toast.error(data.message ?? `Failed to start the ${platformLabel} connection`);
        setIsConnecting(false);
        return;
      }

      popup.location.href = data.authUrl;
      watchPopupUntilClosedOrTimedOut();
    } catch (error) {
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
      console.error(`[ConnectPlatformButton] Error starting ${platform} connection:`, error);
      toast.error(`Failed to start the ${platformLabel} connection`);
      setIsConnecting(false);
    }
  };

  const handleButtonClick = () => {
    if (canConnect) {
      openConnectPopup();
    } else {
      setShowLimitModal(true);
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
        currentCount={currentCount}
        maxAllowed={maxAllowed}
      />
    </>
  );
}
