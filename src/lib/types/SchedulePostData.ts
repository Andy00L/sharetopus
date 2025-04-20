import { PrivacyLevel } from "./dbTypes";

// Define the structure of the data expected by this action
export interface SchedulePostData {
  socialAccountId: string;
  platform: string;
  scheduledAt: string | Date; // ISO string or Date object
  title: string | null;
  mediaType: "video" | "image"; // Extended to support images
  mediaStoragePath: string; // Path from Supabase Storage
  postOptions: {
    // TikTok-specific options
    privacyLevel?: PrivacyLevel;
    disableComment?: boolean;
    disableDuet?: boolean;
    disableStitch?: boolean;

    // Pinterest-specific options
    board?: string;
    link?: string;

    // Add other platform options here as needed
  } | null;
}
