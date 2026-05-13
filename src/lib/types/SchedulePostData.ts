import { PrivacyLevel } from "./dbTypes";

// Define the structure of the data expected by this action
export interface SchedulePostData {
  socialAccountId: string;
  platform: string;
  scheduledAt: string | Date; // ISO string or Date object
  title?: string | null;
  description: string | null;
  postType: "video" | "image" | "text"; // Extended to support images
  mediaStoragePath: string; // Path from Supabase Storage
  coverTimestamp?: number;
  batch_id: string;
  postOptions: {
    // TikTok-specific options
    privacyLevel?: PrivacyLevel;
    disableComment?: boolean;
    disableDuet?: boolean;
    disableStitch?: boolean;
    brandContentToggle?: boolean;
    yourBrand?: boolean;
    brandedContent?: boolean;
    isAigc?: boolean;

    // Pinterest-specific options
    board?: string;
    boardName?: string;
    link?: string;

    // LinkedIn-specific options
    visibility?: string;
    memberUrn?: string;
    // Add other platform options here as needed
  } | null;
  idempotency_key?: string;
}
