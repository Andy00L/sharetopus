"use client";

import { useState } from "react";
import { createShareLink } from "@/actions/server/share-link/createShareLink";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

/**
 * Dialog for creating a new TikTok share link.
 *
 * Two-step flow: first shows the creation form (expiry + max_uses),
 * then on success swaps to a result view with a copyable URL.
 *
 * Called by: connections page (TikTok section)
 * Server action: createShareLink
 */

type ExpiryOption = "3600" | "21600" | "86400" | "forever";
type MaxUsesOption = "1" | "5" | "10" | "unlimited";

export function CreateShareLinkDialog() {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expiry, setExpiry] = useState<ExpiryOption>("86400");
  const [maxUses, setMaxUses] = useState<MaxUsesOption>("1");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCreate() {
    setIsSubmitting(true);
    setErrorMessage(null);

    const expirySeconds = expiry === "forever" ? null : parseInt(expiry, 10);
    const maxUsesValue = maxUses === "unlimited" ? null : parseInt(maxUses, 10);

    const result = await createShareLink({
      platform: "tiktok",
      expirySeconds,
      maxUses: maxUsesValue,
    });

    setIsSubmitting(false);

    if (result.success) {
      setResultUrl(result.data.shareUrl);
    } else {
      setErrorMessage(result.message);
    }
  }

  function handleCopy() {
    if (!resultUrl) return;
    navigator.clipboard.writeText(resultUrl);
    toast.success("Link copied to clipboard");
  }

  function handleClose() {
    setOpen(false);
    // Reset state after close animation
    setTimeout(() => {
      setResultUrl(null);
      setErrorMessage(null);
      setExpiry("86400");
      setMaxUses("1");
    }, 200);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) handleClose();
      else setOpen(true);
    }}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
        >
          Share Link
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {resultUrl ? (
          <>
            <DialogHeader>
              <DialogTitle>Share link created</DialogTitle>
              <DialogDescription>
                Send this link to a friend so they can connect their TikTok
                account.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={resultUrl}
                className="text-xs"
              />
              <Button
                type="button"
                size="sm"
                onClick={handleCopy}
                style={{ backgroundColor: "#FF4A20" }}
                className="text-white shrink-0"
              >
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anyone with this link can connect their TikTok to your Sharetopus
              account. Only share it with people you trust.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create a TikTok share link</DialogTitle>
              <DialogDescription>
                Let a friend connect their TikTok account to your Sharetopus so
                you can post to it.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Expiry options */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Link expires in</Label>
                <RadioGroup
                  value={expiry}
                  onValueChange={(value) => setExpiry(value as ExpiryOption)}
                  className="grid grid-cols-2 gap-2"
                >
                  {[
                    { value: "3600", label: "1 hour" },
                    { value: "21600", label: "6 hours" },
                    { value: "86400", label: "24 hours" },
                    { value: "forever", label: "Never" },
                  ].map((option) => (
                    <div key={option.value} className="flex items-center space-x-2">
                      <RadioGroupItem value={option.value} id={`expiry-${option.value}`} />
                      <Label htmlFor={`expiry-${option.value}`} className="text-sm cursor-pointer">
                        {option.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              {/* Max uses */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Max uses</Label>
                <Select
                  value={maxUses}
                  onValueChange={(value) => setMaxUses(value as MaxUsesOption)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 (default)</SelectItem>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="unlimited">Unlimited</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {errorMessage && (
                <p className="text-sm text-destructive">{errorMessage}</p>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={isSubmitting}
                style={{ backgroundColor: "#FF4A20" }}
                className="text-white"
              >
                {isSubmitting ? "Creating..." : "Create Link"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
