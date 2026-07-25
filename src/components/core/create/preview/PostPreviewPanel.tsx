"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import SocialAvatarWrapper from "@/components/SocialAvatarWrapper";
import { getPlatformDisplayLabel } from "@/lib/platforms/capabilities";
import type { MediaType } from "@/lib/types/dbTypes";
import { resolvePlatformTextLimit } from "../constants/captionLimits";
import type { AccountContentEntry } from "../SocialPostForm/hooks/useAccountContent";
import PlatformPostPreview, {
  type PreviewableAccount,
} from "./PlatformPostPreview";

interface PostPreviewPanelProps {
  /** The currently selected accounts, in selection order. */
  readonly accounts: PreviewableAccount[];
  readonly accountContent: AccountContentEntry[];
  readonly defaultTitle: string;
  readonly defaultDescription: string;
  readonly postType: MediaType;
  readonly selectedFile: File | null;
  readonly previewUrl: string | null;
  readonly pinterestLink: string;
}

/**
 * Live post preview for the composer's right column: pick any selected
 * account and see exactly what it will publish, with that platform's real
 * character limit counted against the effective caption (per-account
 * overrides included).
 */
export default function PostPreviewPanel({
  accounts,
  accountContent,
  defaultTitle,
  defaultDescription,
  postType,
  selectedFile,
  previewUrl,
  pinterestLink,
}: PostPreviewPanelProps) {
  const [previewAccountId, setPreviewAccountId] = useState<string | null>(null);

  // Derived active account: the picked one while it stays selected,
  // otherwise the first selected account. No effect needed.
  const activeAccount =
    accounts.find((account) => account.id === previewAccountId) ??
    accounts[0] ??
    null;

  if (!activeAccount) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card p-6 text-center">
        <Eye className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm font-medium">Live preview</p>
        <p className="text-xs text-muted-foreground">
          Select an account above to see how your post will look.
        </p>
      </div>
    );
  }

  const activeContentEntry = accountContent.find(
    (entry) => entry.accountId === activeAccount.id,
  );
  const effectiveCaption =
    activeContentEntry?.description ?? defaultDescription;
  const effectiveTitle = activeContentEntry?.title ?? defaultTitle;

  const characterLimit = resolvePlatformTextLimit(activeAccount.platform);
  const characterCount = effectiveCaption.length;
  const overLimitBy = characterCount - characterLimit;
  const platformLabel = getPlatformDisplayLabel(activeAccount.platform);

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Eye className="h-4 w-4 text-muted-foreground" />
          Preview
        </h2>
        {activeContentEntry?.isCustomized && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
            Customized caption
          </span>
        )}
      </div>

      {accounts.length > 1 && (
        <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
          {accounts.map((account) => {
            const isActive = account.id === activeAccount.id;
            return (
              <button
                key={account.id}
                type="button"
                onClick={() => setPreviewAccountId(account.id)}
                aria-label={`Preview as ${
                  account.display_name ?? account.username ?? account.platform
                }`}
                aria-pressed={isActive}
                className={`flex-shrink-0 rounded-full transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive ? "opacity-100" : "opacity-50 grayscale hover:opacity-80"
                }`}
              >
                <SocialAvatarWrapper
                  src={account.avatar_url}
                  alt={account.username ?? "Account"}
                  platform={account.platform}
                  className="h-8 w-8"
                  size={32}
                  isSelected={isActive}
                />
              </button>
            );
          })}
        </div>
      )}

      <PlatformPostPreview
        account={activeAccount}
        caption={effectiveCaption}
        title={effectiveTitle}
        postType={postType}
        selectedFile={selectedFile}
        previewUrl={previewUrl}
        pinterestLink={pinterestLink}
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          Approximation of the final look on {platformLabel}.
        </p>
        <span
          className={`font-mono text-[11px] tabular-nums ${
            overLimitBy > 0 ? "font-semibold text-destructive" : "text-muted-foreground"
          }`}
        >
          {characterCount} / {characterLimit}
        </span>
      </div>
      {overLimitBy > 0 && (
        <p className="mt-1 text-xs text-destructive">
          {overLimitBy} character{overLimitBy === 1 ? "" : "s"} over the{" "}
          {platformLabel} limit. Publishing to this account may fail.
        </p>
      )}
    </div>
  );
}
