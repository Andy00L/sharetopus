import { PlatformOptions } from "@/lib/types/dbTypes";
import { format } from "date-fns";

export const defaultPlatformOptions: PlatformOptions = {
  tiktok: {
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

export const defaultTextInputs: { title: string; description: string; link: string } = {
  title: "",
  description: "",
  link: "",
};
