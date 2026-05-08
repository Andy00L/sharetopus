"use client";

import AvatarWithFallback from "@/components/AvatarWithFallback";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SocialAccount } from "@/lib/types/dbTypes";
import {
  CAPTION_LIMITS,
  CaptionPlatform,
} from "../../constants/captionLimits";
import type { AccountContentEntry } from "../hooks/useAccountContent";

interface CaptionsTabProps {
  readonly accounts: SocialAccount[];
  readonly selectedAccounts: Record<string, boolean>;
  readonly accountContent: AccountContentEntry[];
  readonly editingAccounts: Record<string, boolean>;
  readonly onSetCustomCaption: (
    accountId: string,
    description: string,
    isCustomized: boolean
  ) => void;
  readonly onClearCustomization: (
    accountId: string,
    defaultDescription: string,
    defaultTitle: string
  ) => void;
  readonly onSetEditing: (accountId: string, editing: boolean) => void;
}

export default function CaptionsTab({
  accounts,
  selectedAccounts,
  accountContent,
  editingAccounts,
  onSetCustomCaption,
  onClearCustomization,
  onSetEditing,
}: CaptionsTabProps) {
  return (
    <div className="space-y-4">
      {accounts
        .filter((account) => selectedAccounts[account.id])
        .map((account) => {
          const accountData = accountContent.find(
            (item) => item.accountId === account.id
          );
          const isCustomized = accountData?.isCustomized || false;
          const isEditing = editingAccounts[account.id] || false;
          const platformLimit =
            CAPTION_LIMITS[account.platform as CaptionPlatform] ||
            CAPTION_LIMITS.default;

          return (
            <div key={`caption-${account.id}`} className="border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <AvatarWithFallback
                    src={account.avatar_url}
                    alt={account.username ?? "Account"}
                    size={42}
                    className="h-8 w-8"
                  />
                  <span className="font-medium">
                    {account.display_name ?? account.username}
                  </span>
                  {isCustomized && (
                    <span className="text-xs text-muted-foreground">
                      (Customized)
                    </span>
                  )}
                </div>
                <Button
                  className="cursor-pointer"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (isEditing || isCustomized) {
                      const defaultContent = accountContent.find(
                        (item) => !item.isCustomized
                      );
                      onClearCustomization(
                        account.id,
                        defaultContent?.description || "",
                        defaultContent?.title || ""
                      );
                      onSetEditing(account.id, false);
                    } else {
                      onSetEditing(account.id, true);
                    }
                  }}
                >
                  {isEditing || isCustomized ? "Clear" : "Edit"}
                </Button>
              </div>

              <div className="space-y-2 bg-white border rounded-lg ">
                <Textarea
                  value={accountData?.description || ""}
                  onChange={(e) => {
                    if (isEditing) {
                      onSetCustomCaption(
                        account.id,
                        e.target.value.slice(0, platformLimit),
                        true
                      );
                    }
                  }}
                  placeholder="Caption for this account"
                  rows={3}
                  disabled={!isEditing}
                  className={`max-h-40 overflow-y-auto ${
                    !isEditing ? "bg-muted/20" : "bg-white"
                  }`}
                  maxLength={platformLimit}
                />
                {isEditing && (
                  <div className="text-xs text-right text-muted-foreground">
                    {accountData?.description?.length || 0} / {platformLimit}{" "}
                    characters
                  </div>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}
