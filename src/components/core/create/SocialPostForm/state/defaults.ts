import { PlatformOptions } from "@/lib/types/dbTypes";
import { format } from "date-fns";

// Master switch for TikTok Content Posting API compliance UX.
// When true: shows the privacy dropdown, interaction checkboxes,
// commercial content disclosure, declaration text, and processing
// notice required by TikTok review.
// When false: form behaves as it did pre-compliance (hardcoded
// privacy SELF_ONLY, no settings tab, no declarations).
// Flip to true when re-recording the TikTok demo video.
// See change/REPORT.md "FIX TIKTOK-COMPLIANCE" entry.
export const TIKTOK_COMPLIANCE_UI_ENABLED = true;

export const defaultPlatformOptions: PlatformOptions = {
  tiktok: TIKTOK_COMPLIANCE_UI_ENABLED
    ? {
        // Compliance mode: user must explicitly select all options.
        // privacyLevel intentionally omitted (undefined) so no default.
        disableComment: true,
        disableDuet: true,
        disableStitch: true,
        brandContentToggle: false,
        yourBrand: false,
        brandedContent: false,
        isAigc: false,
      }
    : {
        privacyLevel: "SELF_ONLY",
        disableComment: false,
        disableDuet: false,
        disableStitch: false,
      },
  pinterest: {
    privacyLevel: "PUBLIC",
    board: "",
    link: "",
  },
  linkedin: {
    visibility: "PUBLIC",
  },
};

export function getDefaultScheduledDate(): string {
  return format(new Date(Date.now() + 24 * 60 * 60 * 1000), "yyyy-MM-dd");
}

export const DEFAULT_SCHEDULED_TIME = "12:00" as const;

export const defaultTextInputs: {
  title: string;
  description: string;
  link: string;
} = {
  title: "",
  description: "",
  link: "",
};
