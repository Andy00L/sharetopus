"use client";

import AvatarWithFallback from "@/components/AvatarWithFallback";
import { PlatformBrandIcon } from "@/components/icons/platformBrandIcons";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { MediaType } from "@/db/schema";
import type {
  ClientSocialAccount,
  PrivacyLevel,
  TikTokOptions,
} from "@/lib/types/dbTypes";
import type { CreatorInfoData } from "../hooks/useTikTokCreatorInfo";
import {
  TIKTOK_BRANDED_CONTENT_NOT_PRIVATE,
  TIKTOK_DISCLOSURE_CHOICE_REQUIRED,
  TIKTOK_PHOTO_TITLE_MAX_LENGTH,
  describeTikTokAccount,
  formatVideoDuration,
  type TikTokCapabilities,
} from "../validation/tikTokPublishRules";

interface TikTokPostSettingsProps {
  readonly selectedTikTokAccounts: ClientSocialAccount[];
  readonly creatorInfo: Record<string, CreatorInfoData>;
  readonly isLoadingCreatorInfo: Record<string, boolean>;
  readonly creatorInfoErrors: Record<string, string | null>;
  readonly capabilities: TikTokCapabilities | null;
  readonly postType: MediaType;
  readonly tikTokOptions: TikTokOptions;
  readonly onOptionsChange: (update: Partial<TikTokOptions>) => void;
  readonly photoTitle: string;
  readonly onPhotoTitleChange: (title: string) => void;
  /** Null until the selected video's metadata has loaded. */
  readonly videoDurationSec: number | null;
}

/** Display names for privacy_level_options values (PUBLIC and PROTECTED are Pinterest's). */
const PRIVACY_LEVEL_LABELS: Record<PrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: "Public",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
  PUBLIC: "Public",
  PROTECTED: "Protected",
};

/**
 * The TikTok part of the composer, always visible while a TikTok account
 * is selected, laid out in the order TikTok's Content Sharing Guidelines
 * describe: the account the post goes to, the title for photos, who can
 * view it (no default), the interactions (none ticked by default, greyed
 * when the creator turned them off), and the commercial content
 * disclosure. The declaration and the publish button live in
 * SchedulingPanel; the blocking rules in tikTokPublishRules.
 */
export default function TikTokPostSettings({
  selectedTikTokAccounts,
  creatorInfo,
  isLoadingCreatorInfo,
  creatorInfoErrors,
  capabilities,
  postType,
  tikTokOptions,
  onOptionsChange,
  photoTitle,
  onPhotoTitleChange,
  videoDurationSec,
}: TikTokPostSettingsProps) {
  const mediaNoun = postType === "video" ? "video" : "photo";
  const isBrandedContent = tikTokOptions.brandedContent === true;
  const isDisclosureOn = tikTokOptions.brandContentToggle === true;
  const isPrivacySelfOnly = tikTokOptions.privacyLevel === "SELF_ONLY";
  const isVideoTooLong =
    capabilities !== null &&
    videoDurationSec !== null &&
    videoDurationSec > capabilities.maxVideoDurationSec;

  function handleDisclosureChange(isOn: boolean) {
    // Turning disclosure off clears both choices so no label is sent.
    onOptionsChange(
      isOn
        ? { brandContentToggle: true }
        : { brandContentToggle: false, yourBrand: false, brandedContent: false },
    );
  }

  return (
    <section
      aria-labelledby="tiktok-settings-heading"
      className="space-y-6 rounded-2xl border bg-card p-4"
    >
      <div className="space-y-3">
        <h2
          id="tiktok-settings-heading"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <span className="text-foreground [&>svg]:!size-4">
            <PlatformBrandIcon platform="tiktok" />
          </span>
          Posting to TikTok as
        </h2>
        <ul className="space-y-3">
          {selectedTikTokAccounts.map((account) => {
            const accountInfo = creatorInfo[account.id];
            const accountError = creatorInfoErrors[account.id];
            const username = accountInfo?.creator_username ?? account.username;
            return (
              <li key={account.id} className="space-y-1">
                <div className="flex items-center gap-3">
                  <AvatarWithFallback
                    src={account.avatar_url}
                    alt={describeTikTokAccount(account, accountInfo)}
                    size={36}
                    className="h-9 w-9"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {describeTikTokAccount(account, accountInfo)}
                    </p>
                    {username && (
                      <p className="truncate text-xs text-muted-foreground">
                        @{username}
                      </p>
                    )}
                  </div>
                  {isLoadingCreatorInfo[account.id] && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Loading settings...
                    </span>
                  )}
                </div>
                {accountError && (
                  <p role="alert" className="text-sm text-destructive">
                    {accountError}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {capabilities && (
        <>
          {isVideoTooLong && (
            <p role="alert" className="text-sm text-destructive">
              This video is {formatVideoDuration(videoDurationSec)} long.
              TikTok accepts videos up to{" "}
              {formatVideoDuration(capabilities.maxVideoDurationSec)} for{" "}
              {selectedTikTokAccounts.length === 1
                ? "this account"
                : "the selected accounts"}
              . Choose a shorter video to post to TikTok.
            </p>
          )}

          {postType === "image" && (
            <div className="space-y-2">
              <Label htmlFor="tiktok-photo-title">Title</Label>
              <Input
                id="tiktok-photo-title"
                value={photoTitle}
                onChange={(event) => onPhotoTitleChange(event.target.value)}
                maxLength={TIKTOK_PHOTO_TITLE_MAX_LENGTH}
                placeholder="Add a title for your TikTok photo"
                className="bg-card"
              />
              <p className="text-right text-xs text-muted-foreground">
                {photoTitle.length} / {TIKTOK_PHOTO_TITLE_MAX_LENGTH}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="tiktok-privacy">Who can view this {mediaNoun}</Label>
            <Select
              value={tikTokOptions.privacyLevel ?? ""}
              onValueChange={(value) => {
                const selectedOption = capabilities.privacyOptions.find(
                  (option) => option === value,
                );
                if (selectedOption) {
                  onOptionsChange({ privacyLevel: selectedOption });
                }
              }}
            >
              <SelectTrigger id="tiktok-privacy" className="w-full bg-card">
                <SelectValue placeholder="Select who can view" />
              </SelectTrigger>
              <SelectContent>
                {capabilities.privacyOptions.map((option) => {
                  const isBlockedByBrandedContent =
                    option === "SELF_ONLY" && isBrandedContent;
                  return (
                    <SelectItem
                      key={option}
                      value={option}
                      disabled={isBlockedByBrandedContent}
                    >
                      {isBlockedByBrandedContent ? (
                        <span className="flex flex-col items-start">
                          <span>{PRIVACY_LEVEL_LABELS[option]}</span>
                          <span className="text-xs text-muted-foreground">
                            {TIKTOK_BRANDED_CONTENT_NOT_PRIVATE}
                          </span>
                        </span>
                      ) : (
                        PRIVACY_LEVEL_LABELS[option]
                      )}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Allow users to</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <InteractionCheckbox
                id="tiktok-allow-comment"
                label="Comment"
                isTurnedOffByCreator={capabilities.commentDisabled}
                isDisabledOption={tikTokOptions.disableComment}
                onChange={(isAllowed) =>
                  onOptionsChange({ disableComment: !isAllowed })
                }
              />
              {/* Duet and Stitch do not exist for photo posts. */}
              {postType === "video" && (
                <>
                  <InteractionCheckbox
                    id="tiktok-allow-duet"
                    label="Duet"
                    isTurnedOffByCreator={capabilities.duetDisabled}
                    isDisabledOption={tikTokOptions.disableDuet}
                    onChange={(isAllowed) =>
                      onOptionsChange({ disableDuet: !isAllowed })
                    }
                  />
                  <InteractionCheckbox
                    id="tiktok-allow-stitch"
                    label="Stitch"
                    isTurnedOffByCreator={capabilities.stitchDisabled}
                    isDisabledOption={tikTokOptions.disableStitch}
                    onChange={(isAllowed) =>
                      onOptionsChange({ disableStitch: !isAllowed })
                    }
                  />
                </>
              )}
            </div>
            {(capabilities.commentDisabled ||
              (postType === "video" &&
                (capabilities.duetDisabled || capabilities.stitchDisabled))) && (
              <p className="text-xs text-muted-foreground">
                Greyed-out options are turned off in this account&apos;s
                TikTok settings.
              </p>
            )}
          </fieldset>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="tiktok-disclose">
                  Disclose {mediaNoun} content
                </Label>
                <p className="text-xs text-muted-foreground">
                  Turn on to disclose that this {mediaNoun} promotes goods or
                  services in exchange for something of value. Your {mediaNoun}{" "}
                  could promote yourself, a third party, or both.
                </p>
              </div>
              <Switch
                id="tiktok-disclose"
                checked={isDisclosureOn}
                onCheckedChange={handleDisclosureChange}
              />
            </div>

            {isDisclosureOn && (
              <div className="space-y-4 rounded-xl border p-3">
                <DisclosureOption
                  id="tiktok-your-brand"
                  label="Your brand"
                  description={`You are promoting yourself or your own business. This ${mediaNoun} will be classified as Brand Organic.`}
                  isChecked={tikTokOptions.yourBrand === true}
                  isDisabled={false}
                  onChange={(isChecked) =>
                    onOptionsChange({ yourBrand: isChecked })
                  }
                />
                <DisclosureOption
                  id="tiktok-branded-content"
                  label="Branded content"
                  description={
                    isPrivacySelfOnly
                      ? TIKTOK_BRANDED_CONTENT_NOT_PRIVATE
                      : `You are promoting another brand or a third party. This ${mediaNoun} will be classified as Branded Content.`
                  }
                  isChecked={isBrandedContent}
                  isDisabled={isPrivacySelfOnly}
                  onChange={(isChecked) =>
                    onOptionsChange({ brandedContent: isChecked })
                  }
                />

                {tikTokOptions.yourBrand !== true && !isBrandedContent ? (
                  <p role="alert" className="text-xs text-destructive">
                    {TIKTOK_DISCLOSURE_CHOICE_REQUIRED}
                  </p>
                ) : (
                  <p className="text-xs font-medium">
                    Your {mediaNoun} will be labeled as{" "}
                    {isBrandedContent
                      ? "'Paid partnership'"
                      : "'Promotional content'"}
                    .
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * One "Allow users to" checkbox. Unticked by default; greyed out and
 * unticked when the creator turned the interaction off in TikTok.
 */
function InteractionCheckbox({
  id,
  label,
  isTurnedOffByCreator,
  isDisabledOption,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly isTurnedOffByCreator: boolean;
  /** The stored disable_* flag; only an explicit false means allowed. */
  readonly isDisabledOption: boolean | undefined;
  readonly onChange: (isAllowed: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={!isTurnedOffByCreator && isDisabledOption === false}
        disabled={isTurnedOffByCreator}
        onCheckedChange={(checkedState) => onChange(checkedState === true)}
      />
      <Label
        htmlFor={id}
        className={isTurnedOffByCreator ? "text-muted-foreground" : undefined}
      >
        {label}
      </Label>
    </div>
  );
}

/** One commercial disclosure choice with TikTok's explanation under it. */
function DisclosureOption({
  id,
  label,
  description,
  isChecked,
  isDisabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly isChecked: boolean;
  readonly isDisabled: boolean;
  readonly onChange: (isChecked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={isChecked}
        disabled={isDisabled}
        onCheckedChange={(checkedState) => onChange(checkedState === true)}
        className="mt-0.5"
      />
      <div className="space-y-1">
        <Label
          htmlFor={id}
          className={isDisabled ? "text-muted-foreground" : undefined}
        >
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
