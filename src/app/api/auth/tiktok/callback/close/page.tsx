// app/api/auth/tiktok/callback/close/page.tsx
"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Composant qui utilise useSearchParams, à envelopper dans Suspense
function CallbackContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get("success");
  const error = searchParams.get("error");

  // Détermine le message de statut
  let statusMessage = "Processing...";
  if (success) {
    statusMessage = "Connection Successful";
  } else if (error) {
    statusMessage = "Connection Failed";
  }

  // Détermine le message de description
  let descriptionMessage = "Completing your TikTok account connection...";
  if (success) {
    descriptionMessage =
      "Your TikTok account has been connected. This window will close automatically.";
  } else if (error) {
    descriptionMessage = `Error: ${error}. This window will close automatically.`;
  }

  useEffect(() => {
    // Attendre un court instant pour s'assurer que la page est chargée
    const timer = setTimeout(() => {
      if (window.opener) {
        // Communiquer avec la fenêtre parente
        if (success) {
          window.opener.postMessage(
            {
              type: "tiktok-auth-success",
              accountData: success,
            },
            window.location.origin
          );
        } else if (error) {
          window.opener.postMessage(
            {
              type: "tiktok-auth-error",
              message: error,
            },
            window.location.origin
          );
        }

        // Fermer la fenêtre
        window.close();
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [success, error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mb-4"></div>
      <h1 className="text-xl font-semibold mb-2">{statusMessage}</h1>
      <p className="text-muted-foreground">{descriptionMessage}</p>
    </div>
  );
}

// Composant Fallback pour Suspense
function CallbackFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mb-4"></div>
      <h1 className="text-xl font-semibold mb-2">Loading...</h1>
      <p className="text-muted-foreground">
        Please wait while we process your request...
      </p>
    </div>
  );
}

// Composant principal qui utilise Suspense
export default function TikTokCallbackClose() {
  return (
    <Suspense fallback={<CallbackFallback />}>
      <CallbackContent />
    </Suspense>
  );
}
