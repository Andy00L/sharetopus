"use client";

import { ImageIcon, Video } from "lucide-react";

import AvatarWithFallback from "@/components/AvatarWithFallback";
import FilePreview from "@/components/renderFilePreview";
import {
  getPlatformBrandIcon,
  PlatformLetterBadge,
} from "@/components/icons/platformBrandIcons";
import { getPlatformDisplayLabel } from "@/lib/platforms/capabilities";
import type { MediaType, SocialAccount } from "@/lib/types/dbTypes";

/**
 * The only account fields the preview reads. Full social_accounts rows
 * satisfy this structurally; narrowing keeps token columns out of the
 * preview's contract.
 */
export type PreviewableAccount = Pick<
  SocialAccount,
  "id" | "platform" | "avatar_url" | "display_name" | "username"
>;

/** Platforms whose publish uses the separate title field. */
const TITLE_PLATFORMS: readonly string[] = ["youtube", "pinterest"];

interface PlatformPostPreviewProps {
  readonly account: PreviewableAccount;
  readonly caption: string;
  readonly title: string;
  readonly postType: MediaType;
  readonly selectedFile: File | null;
  readonly previewUrl: string | null;
  readonly pinterestLink: string;
}

function formatLinkDomain(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return link;
  }
}

/**
 * How the post will read on the selected account: real avatar and names,
 * the caption that account will actually publish (including per-account
 * overrides), the attached media, and the platform-specific extras (title
 * for YouTube/Pinterest, destination link for Pinterest). One neutral
 * card frame on purpose: content accuracy over platform cosplay.
 */
export default function PlatformPostPreview({
  account,
  caption,
  title,
  postType,
  selectedFile,
  previewUrl,
  pinterestLink,
}: PlatformPostPreviewProps) {
  const PlatformIcon = getPlatformBrandIcon(account.platform);
  const platformLabel = getPlatformDisplayLabel(account.platform);
  const showTitle =
    title.length > 0 && TITLE_PLATFORMS.includes(account.platform);
  const showPinterestLink =
    account.platform === "pinterest" && pinterestLink.length > 0;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* Account header */}
      <div className="flex items-center gap-2.5 p-3">
        <AvatarWithFallback
          src={account.avatar_url}
          alt={account.display_name ?? account.username ?? "Account"}
          size={36}
          className="h-9 w-9"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-tight">
            {account.display_name ?? account.username ?? "Connected account"}
          </p>
          {account.username && (
            <p className="truncate text-xs text-muted-foreground">
              @{account.username}
            </p>
          )}
        </div>
        <span className="ml-auto flex flex-shrink-0 items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {PlatformIcon ? (
            <PlatformIcon />
          ) : (
            <PlatformLetterBadge platform={account.platform} />
          )}
          {platformLabel}
        </span>
      </div>

      {/* Text content */}
      <div className="space-y-1.5 px-3 pb-3">
        {showTitle && (
          <p className="text-sm font-semibold leading-snug break-words">
            {title}
          </p>
        )}
        {caption.length > 0 ? (
          <p className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
            {caption}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            Your caption will appear here.
          </p>
        )}
        {showPinterestLink && (
          <p className="truncate text-xs text-muted-foreground underline underline-offset-2">
            {formatLinkDomain(pinterestLink)}
          </p>
        )}
      </div>

      {/* Media */}
      {postType !== "text" && (
        <div className="border-t">
          {selectedFile && previewUrl ? (
            <div className="flex max-h-64 items-center justify-center overflow-hidden bg-muted/30 [&_img]:max-h-64 [&_img]:w-auto [&_img]:object-contain [&_video]:max-h-64 [&_video]:w-auto [&_video]:object-contain">
              <FilePreview
                selectedFile={selectedFile}
                mediaType={postType}
                previewUrl={previewUrl}
              />
            </div>
          ) : (
            <div className="flex h-32 flex-col items-center justify-center gap-1.5 bg-muted/30 text-muted-foreground">
              {postType === "image" ? (
                <ImageIcon className="h-6 w-6" />
              ) : (
                <Video className="h-6 w-6" />
              )}
              <span className="text-xs">
                Add your {postType} to complete the preview
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
