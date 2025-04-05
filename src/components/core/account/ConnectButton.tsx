// components/tiktok/ConnectButton.tsx
"use client";

import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export function ConnectTikTokButton() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [authWindow, setAuthWindow] = useState<Window | null>(null);

  // Fonction pour gérer le nettoyage quand la fenêtre est fermée
  useEffect(() => {
    const checkWindow = () => {
      if (authWindow && authWindow.closed) {
        setIsConnecting(false);
        setAuthWindow(null);
      }
    };

    // Vérifier toutes les 500ms si la fenêtre est fermée
    const interval = setInterval(checkWindow, 500);

    return () => clearInterval(interval);
  }, [authWindow]);

  // Écouter les messages de la fenêtre d'authentification
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Vérifier l'origine pour la sécurité
      if (event.origin !== window.location.origin) return;

      // Vérifier si le message est relatif à l'authentification TikTok
      if (event.data?.type === "tiktok-auth-success") {
        setIsConnecting(false);
        setAuthWindow(null);
        toast.success("TikTok account connected successfully!");

        // Ici vous pourriez rafraîchir la liste des comptes ou autre action
        // Par exemple: router.refresh() si vous utilisez Next.js App Router
      }

      if (event.data?.type === "tiktok-auth-error") {
        setIsConnecting(false);
        setAuthWindow(null);
        toast.error(
          `Failed to connect TikTok account: ${
            event.data.message || "Unknown error"
          }`
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleConnect = async () => {
    setIsConnecting(true);

    // Ouvrir une nouvelle fenêtre
    const authPopup = window.open(
      "/api/auth/tiktok",
      "Connect TikTok",
      "width=600,height=700,left=100,top=100"
    );

    // Vérifier si la fenêtre a été ouverte avec succès
    if (
      !authPopup ||
      authPopup.closed ||
      typeof authPopup.closed === "undefined"
    ) {
      toast.error("Pop-up was blocked. Please allow pop-ups for this site.");
      setIsConnecting(false);
      return;
    }

    setAuthWindow(authPopup);

    // Mettre le focus sur la fenêtre pop-up
    authPopup.focus();
  };

  return (
    <Button
      onClick={handleConnect}
      disabled={isConnecting}
      className="bg-[#000000] hover:bg-[#333333] text-white"
    >
      {isConnecting ? "Connecting..." : "Connect TikTok Account"}
    </Button>
  );
}
