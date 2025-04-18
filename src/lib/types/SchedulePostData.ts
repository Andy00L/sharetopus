import { TikTokPrivacyLevel } from "./TikTokPrivacyLevel ";

// Define the structure of the data expected by this action
export interface SchedulePostData {
  socialAccountId: string;
  platform: string;
  scheduledAt: string | Date; // ISO string or Date object
  title: string | null;
  mediaType: "video" | "image"; // Extend as needed
  mediaStoragePath: string; // Path from Supabase Storage
  postOptions: {
    // Platform-specific options
    privacyLevel?: TikTokPrivacyLevel;
    disableComment?: boolean;
    disableDuet?: boolean;
    disableStitch?: boolean;
    // Add other platform options here as needed
  } | null;
}
