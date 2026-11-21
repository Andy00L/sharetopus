import { PlatformOptions } from "@/lib/types/dbTypes";
import { format } from "date-fns";

export const defaultPlatformOptions: PlatformOptions = {
  // TikTok Content Sharing Guidelines, Required UX Implementation 2b, 2c and 3a:
  // no privacy default, no interaction allowed until ticked, disclosure off.
  tiktok: {
    disableComment: true,
    disableDuet: true,
    disableStitch: true,
    brandContentToggle: false,
    yourBrand: false,
    brandedContent: false,
    isAigc: false,
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
