// components/tiktok/ConnectButton.tsx
"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ConnectTikTokButton() {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    router.push("/api/auth/tiktok");
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
