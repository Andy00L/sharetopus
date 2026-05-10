import type { TikTokOptions } from "@/lib/types/dbTypes";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
} from "../../constants/constants";

type BoardInfo = {
  boardID: string;
  boardName: string;
  accountId: string;
  isSelected: boolean;
};

type SelectedPinterestAccount = {
  id: string;
  display_name: string | null;
  username: string | null;
};

export interface CheckFormParams {
  userId: string | null;
  selectedAccounts: Record<string, boolean>;
  postType: "text" | "image" | "video";
  selectedFile: File | null;
  maxImageSizeBytes: number;
  maxVideoSizeBytes: number;
  uploadLimits?: { image: number; video: number };
  isScheduled: boolean;
  scheduledDate: string;
  scheduledTime: string;
  selectedPinterestAccounts: SelectedPinterestAccount[];
  boards: BoardInfo[];
  // FIX TIKTOK-COMPLIANCE
  tiktokComplianceEnabled: boolean;
  selectedTikTokAccounts: { id: string }[];
  tikTokOptions?: TikTokOptions;
}

export type CheckFormResult =
  | { valid: true }
  | { valid: false; message: string };

export function checkFormSubmission(params: CheckFormParams): CheckFormResult {
  const {
    userId,
    selectedAccounts,
    postType,
    selectedFile,
    maxImageSizeBytes,
    maxVideoSizeBytes,
    uploadLimits,
    isScheduled,
    scheduledDate,
    scheduledTime,
    selectedPinterestAccounts,
    boards,
    tiktokComplianceEnabled,
    selectedTikTokAccounts,
    tikTokOptions,
  } = params;

  if (!userId) {
    console.error("[checkFormSubmission]: User not authenticated");
    return {
      valid: false,
      message: "User not authenticated. Please sign in to continue.",
    };
  }

  const selectedAccountCount =
    Object.values(selectedAccounts).filter(Boolean).length;
  if (selectedAccountCount === 0) {
    console.error("[checkFormSubmission]: No accounts selected");
    return { valid: false, message: "Please select at least one account" };
  }

  if (postType === "video" || postType === "image") {
    if (!selectedFile) {
      console.error("[checkFormSubmission]: Missing required media file");
      return {
        valid: false,
        message: `Please select a ${postType} file to upload`,
      };
    }

    if (postType === "image") {
      if (!ALLOWED_IMAGE_TYPES.includes(selectedFile.type)) {
        console.error(
          "[checkFormSubmission]: Invalid image format:",
          selectedFile.type
        );
        return {
          valid: false,
          message: "Please select a valid image file format (JPEG, PNG)",
        };
      }

      if (selectedFile.size > maxImageSizeBytes) {
        console.error(
          "[checkFormSubmission]: Image exceeds size limit:",
          selectedFile.size
        );
        return {
          valid: false,
          message: `Image size exceeds the maximum limit of ${
            uploadLimits?.image || 50
          }MB`,
        };
      }
    } else if (postType === "video") {
      if (!ALLOWED_VIDEO_TYPES.includes(selectedFile.type)) {
        console.error(
          "[checkFormSubmission]: Invalid video format:",
          selectedFile.type
        );
        return {
          valid: false,
          message: "Please select a valid video file format (MP4, MOV)",
        };
      }

      if (selectedFile.size > maxVideoSizeBytes) {
        console.error(
          "[checkFormSubmission]: Video exceeds size limit:",
          selectedFile.size
        );
        return {
          valid: false,
          message: `Video size exceeds the maximum limit of ${
            uploadLimits?.video || 50
          }MB`,
        };
      }
    }
  }

  if (isScheduled) {
    if (!scheduledDate || !scheduledTime) {
      console.error("[checkFormSubmission]: Missing scheduled date/time");
      return {
        valid: false,
        message: "Please select both date and time for scheduling",
      };
    }

    const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
    if (scheduledDateTime < new Date()) {
      console.error("[checkFormSubmission]: Scheduled time is in the past");
      return {
        valid: false,
        message: "The scheduled date cannot be in the past",
      };
    }
  }

  if (
    selectedPinterestAccounts.length > 0 &&
    (postType === "video" || postType === "image")
  ) {
    const missingBoardAccount = selectedPinterestAccounts.find(
      (account) =>
        !boards.some(
          (board) => board.accountId === account.id && board.isSelected
        )
    );

    if (missingBoardAccount) {
      console.error(
        "[checkFormSubmission]: Missing Pinterest board selection"
      );
      return {
        valid: false,
        message: `Please select a Pinterest board for ${
          missingBoardAccount.display_name ??
          missingBoardAccount.username ??
          "your account"
        }`,
      };
    }
  }

  // TikTok compliance validation
  if (
    tiktokComplianceEnabled &&
    selectedTikTokAccounts.length > 0 &&
    (postType === "video" || postType === "image")
  ) {
    if (!tikTokOptions?.privacyLevel) {
      console.error("[checkFormSubmission]: TikTok privacy level not selected");
      return {
        valid: false,
        message: "Please select a privacy level for your TikTok post",
      };
    }

    if (
      tikTokOptions.brandContentToggle === true &&
      tikTokOptions.yourBrand !== true &&
      tikTokOptions.brandedContent !== true
    ) {
      console.error(
        "[checkFormSubmission]: Commercial content toggle ON but no type selected"
      );
      return {
        valid: false,
        message:
          "Please indicate if your content promotes yourself, a third party, or both",
      };
    }

    if (
      tikTokOptions.brandedContent === true &&
      tikTokOptions.privacyLevel === "SELF_ONLY"
    ) {
      console.error(
        "[checkFormSubmission]: Branded content cannot use SELF_ONLY privacy"
      );
      return {
        valid: false,
        message:
          'Branded Content posts cannot use "Only me" privacy. Please select a different privacy level.',
      };
    }
  }

  return { valid: true };
}
