"use client";

import { disconnectSocialAccount } from "@/actions/server/disconnectSocialAccount";
import AvatarWithFallback from "@/components/AvatarWithFallback";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SocialAccount } from "@/lib/types/dbTypes";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  readonly account: SocialAccount;
  readonly userId: string;
}

export default function SocialAccountBadge({ account, userId }: Props) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleDisconnect = async () => {
    if (isDisconnecting) return;

    try {
      setIsDisconnecting(true);

      const result = await disconnectSocialAccount(account.id, userId);

      if (result.success) {
        toast.success(result.message);
        setIsDisconnecting(false);
        router.refresh();
      } else {
        toast.error(result.message || "Error disconnecting account.");
        setIsDisconnecting(false);
      }
    } catch (error) {
      console.error("Error disconnecting account:", error);
      toast.error("An error occurred. Please try again.");
      setIsDisconnecting(false);
    }
  };

  return (
    <>
      {/* Alert Dialog for confirmation */}
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect{" "}
              {account.platform.charAt(0).toUpperCase() +
                account.platform.slice(1)}{" "}
              Account?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {account.display_name} from your profile.
              You&apos;ll need to reconnect if you want to use it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Account</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={handleDisconnect}
            >
              Disconnect Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Account Badge */}
      <div
        className={`
  flex items-center gap-2 px-2 py-1 rounded-full 
  ${
    account.is_verified
      ? "border border-blue-500 bg-blue-50 shadow-sm dark:border-blue-400 dark:bg-blue-900/40 dark:text-white"
      : "border border-gray-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
  }${isDisconnecting ? "animate-pulse opacity-70" : ""}
`}
      >
        <div className="h-8 w-8 rounded-full overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
          <AvatarWithFallback
            src={account.avatar_url}
            alt={account.display_name ?? `Utilisateur ${account.platform}`}
            className="h-full w-full"
          />
        </div>

        <span className="text-sm font-medium truncate max-w-[100px]">
          {account.display_name ?? account.username}
        </span>

        <button
          onClick={() => setDialogOpen(true)}
          disabled={isDisconnecting}
          className={`
            rounded-full p-0.5 text-red-500
            ${
              isDisconnecting
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-red-100"
            }
          `}
          aria-label="Déconnecter le compte"
          type="button"
        >
          <X size={14} />
        </button>
      </div>
    </>
  );
}
