// components/core/accounts/ConnectionLimitModal.tsx

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";

interface ConnectionLimitModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly currentCount: number;
  readonly maxAllowed: number;
}

export default function ConnectionLimitModal({
  isOpen,
  onClose,
  currentCount,
  maxAllowed,
}: ConnectionLimitModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Account Connection Limit Reached</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          You have reached your account connection limit. You currently have{" "}
          {currentCount} accounts connected out of a maximum of {maxAllowed}.
        </DialogDescription>
        <DialogDescription className="pt-2">
          To connect more accounts, please upgrade your plan.
        </DialogDescription>
        <DialogFooter className="flex justify-between sm:justify-between">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Link href={"/#pricing"}>
            {" "}
            <Button className="cursor-pointer">Upgrade Plan</Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
