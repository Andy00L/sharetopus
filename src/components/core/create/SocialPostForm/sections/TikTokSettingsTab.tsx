"use client";

import AvatarWithFallback from "@/components/AvatarWithFallback";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MediaType } from "@/lib/types/database.types";
import type {
  PrivacyLevel,
  SocialAccount,
  TikTokOptions,
} from "@/lib/types/dbTypes";
import type { CreatorInfoData } from "../hooks/useTikTokCreatorInfo";

interface TikTokSettingsTabProps {
  readonly selectedTikTokAccounts: SocialAccount[];
  readonly creatorInfo: Record<string, CreatorInfoData>;
  readonly isLoadingCreatorInfo: Record<string, boolean>;
  readonly creatorInfoErrors: Record<string, string | null>;
  readonly postType: MediaType;
  readonly tikTokOptions: TikTokOptions;
  readonly onOptionsChange: (update: Partial<TikTokOptions>) => void;
}

function formatPrivacyLevel(level: PrivacyLevel): string {
  switch (level) {
    case "PUBLIC_TO_EVERYONE":
      return "Public";
    case "MUTUAL_FOLLOW_FRIENDS":
      return "Friends";
    case "FOLLOWER_OF_CREATOR":
      return "Followers";
    case "SELF_ONLY":
      return "Only me";
    default:
      return level;
  }
}

export default function TikTokSettingsTab({
  selectedTikTokAccounts,
  creatorInfo,
  isLoadingCreatorInfo,
  creatorInfoErrors,
  postType,
  tikTokOptions,
  onOptionsChange,
}: TikTokSettingsTabProps) {
  // Aggregate creator info across all selected accounts
  const loadedInfos = selectedTikTokAccounts
    .map((acc) => creatorInfo[acc.id])
    .filter(Boolean);

  const anyLoading = selectedTikTokAccounts.some(
    (acc) => isLoadingCreatorInfo[acc.id],
  );
  const accountErrors = selectedTikTokAccounts
    .filter((acc) => creatorInfoErrors[acc.id])
    .map((acc) => ({
      account: acc,
      error: creatorInfoErrors[acc.id]!,
    }));

  // Privacy options: intersection of all loaded accounts
  const privacyOptions: PrivacyLevel[] =
    loadedInfos.length > 0
      ? loadedInfos.reduce<PrivacyLevel[]>((acc, info) => {
          if (acc.length === 0) return [...info.privacy_level_options];
          return acc.filter((opt) => info.privacy_level_options.includes(opt));
        }, [])
      : [];

  // Interaction flags: disabled if ANY account has it disabled
  const commentForceDisabled = loadedInfos.some((i) => i.comment_disabled);
  const duetForceDisabled = loadedInfos.some((i) => i.duet_disabled);
  const stitchForceDisabled = loadedInfos.some((i) => i.stitch_disabled);

  const isVideo = postType === "video";
  const brandedContentActive = tikTokOptions.brandedContent === true;
  const commercialToggleOn = tikTokOptions.brandContentToggle === true;
  const neitherCommercialSelected =
    commercialToggleOn &&
    tikTokOptions.yourBrand !== true &&
    !brandedContentActive;

  function handleBrandedContentChange(checked: boolean) {
    const update: Partial<TikTokOptions> = { brandedContent: checked };
    // Clear SELF_ONLY if branded content is checked
    // (TikTok spec: branded content cannot be SELF_ONLY)
    if (checked && tikTokOptions.privacyLevel === "SELF_ONLY") {
      update.privacyLevel = undefined;
    }
    onOptionsChange(update);
  }

  return (
    <div className="space-y-4">
      {/* Per-account creator info display */}
      {selectedTikTokAccounts.map((account) => {
        const info = creatorInfo[account.id];
        const loading = isLoadingCreatorInfo[account.id];
        const error = creatorInfoErrors[account.id];

        return (
          <div
            key={`tiktok-${account.id}`}
            className="space-y-2 border rounded p-3 bg-[#e6e6e1]"
          >
            <div className="flex items-center gap-2">
              <AvatarWithFallback
                src={account.avatar_url}
                alt={account.username ?? "Account"}
                size={42}
                className="h-8 w-8"
              />
              <div>
                <span className="font-medium">
                  {info?.creator_nickname ??
                    account.display_name ??
                    account.username}
                </span>
                {info?.creator_username && (
                  <span className="text-xs text-muted-foreground ml-1">
                    @{info.creator_username}
                  </span>
                )}
              </div>
            </div>
            {loading && (
              <p className="text-sm text-muted-foreground">
                Loading TikTok options...
              </p>
            )}
            {error && <p className="text-sm text-red-500">Error: {error}</p>}
          </div>
        );
      })}

      {/* Loading state: don't show controls until at least one account loaded */}
      {anyLoading && loadedInfos.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Loading TikTok creator settings...
        </p>
      )}

      {/* Error state: all accounts failed */}
      {accountErrors.length > 0 &&
        accountErrors.length === selectedTikTokAccounts.length && (
          <p className="text-sm text-red-500">
            Could not load TikTok settings. Your TikTok post may fail without
            the required options.
          </p>
        )}

      {/* Shared controls (shown when at least one account loaded) */}
      {loadedInfos.length > 0 && (
        <>
          {/* Privacy level */}
          <div className="space-y-2">
            <Label>Privacy Level</Label>
            <Select
              value={tikTokOptions.privacyLevel ?? ""}
              onValueChange={(value) =>
                onOptionsChange({ privacyLevel: value as PrivacyLevel })
              }
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Select privacy level" />
              </SelectTrigger>
              <SelectContent>
                {privacyOptions.map((option) => {
                  const isSelfOnlyBlocked =
                    option === "SELF_ONLY" && brandedContentActive;
                  return (
                    <TooltipProvider key={option}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <SelectItem
                              value={option}
                              disabled={isSelfOnlyBlocked}
                            >
                              {formatPrivacyLevel(option)}
                            </SelectItem>
                          </div>
                        </TooltipTrigger>
                        {isSelfOnlyBlocked && (
                          <TooltipContent>
                            <p>
                              &quot;Only me&quot; is not available with Branded
                              Content
                            </p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Interaction settings */}
          <div className="space-y-3">
            <Label>Interaction Settings</Label>

            <div className="flex items-center gap-2">
              <Checkbox
                id="tiktok-allow-comment"
                checked={tikTokOptions.disableComment === false}
                onCheckedChange={(checked) => {
                  if (typeof checked === "boolean") {
                    onOptionsChange({ disableComment: !checked });
                  }
                }}
                disabled={commentForceDisabled}
              />
              <Label
                htmlFor="tiktok-allow-comment"
                className={commentForceDisabled ? "text-muted-foreground" : ""}
              >
                Allow Comment
                {commentForceDisabled && (
                  <span className="text-xs ml-1">(disabled by creator)</span>
                )}
              </Label>
            </div>

            {isVideo && (
              <>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="tiktok-allow-duet"
                    checked={tikTokOptions.disableDuet === false}
                    onCheckedChange={(checked) => {
                      if (typeof checked === "boolean") {
                        onOptionsChange({ disableDuet: !checked });
                      }
                    }}
                    disabled={duetForceDisabled}
                  />
                  <Label
                    htmlFor="tiktok-allow-duet"
                    className={duetForceDisabled ? "text-muted-foreground" : ""}
                  >
                    Allow Duet
                    {duetForceDisabled && (
                      <span className="text-xs ml-1">
                        (disabled by creator)
                      </span>
                    )}
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="tiktok-allow-stitch"
                    checked={tikTokOptions.disableStitch === false}
                    onCheckedChange={(checked) => {
                      if (typeof checked === "boolean") {
                        onOptionsChange({ disableStitch: !checked });
                      }
                    }}
                    disabled={stitchForceDisabled}
                  />
                  <Label
                    htmlFor="tiktok-allow-stitch"
                    className={
                      stitchForceDisabled ? "text-muted-foreground" : ""
                    }
                  >
                    Allow Stitch
                    {stitchForceDisabled && (
                      <span className="text-xs ml-1">
                        (disabled by creator)
                      </span>
                    )}
                  </Label>
                </div>
              </>
            )}
          </div>

          {/* Commercial content disclosure */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Switch
                id="tiktok-commercial"
                checked={commercialToggleOn}
                onCheckedChange={(checked) => {
                  const update: Partial<TikTokOptions> = {
                    brandContentToggle: checked,
                  };
                  if (!checked) {
                    update.yourBrand = false;
                    update.brandedContent = false;
                  }
                  onOptionsChange(update);
                }}
              />
              <Label htmlFor="tiktok-commercial">
                Content promotes a brand, product, or service
              </Label>
            </div>

            {commercialToggleOn && (
              <div className="ml-6 space-y-3 border-l-2 border-muted pl-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="tiktok-your-brand"
                    checked={tikTokOptions.yourBrand === true}
                    onCheckedChange={(checked) => {
                      if (typeof checked === "boolean") {
                        onOptionsChange({ yourBrand: checked });
                      }
                    }}
                  />
                  <Label htmlFor="tiktok-your-brand">Your Brand</Label>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="tiktok-branded-content"
                    checked={brandedContentActive}
                    onCheckedChange={(checked) => {
                      if (typeof checked === "boolean") {
                        handleBrandedContentChange(checked);
                      }
                    }}
                  />
                  <Label htmlFor="tiktok-branded-content">
                    Branded Content
                  </Label>
                </div>

                {/* Warning: neither selected */}
                {neitherCommercialSelected && (
                  <p className="text-xs text-amber-600">
                    You need to indicate if your content promotes yourself, a
                    third party, or both.
                  </p>
                )}

                {/* Label preview */}
                {tikTokOptions.yourBrand === true && !brandedContentActive && (
                  <p className="text-xs text-muted-foreground">
                    Your {isVideo ? "video" : "photo"} will be labeled as
                    &quot;Promotional content&quot;
                  </p>
                )}
                {brandedContentActive && (
                  <p className="text-xs text-muted-foreground">
                    Your {isVideo ? "video" : "photo"} will be labeled as
                    &quot;Paid partnership&quot;
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
