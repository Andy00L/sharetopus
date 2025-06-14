"use client";

import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";
import AvatarWithFallback from "@/components/AvatarWithFallback";
import SocialAvatarWrapper from "@/components/SocialAvatarWrapper";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarGroup } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { createPinterestBoard } from "@/lib/api/pinterest/data/createPinterestBoard";
import { getPinterestBoards } from "@/lib/api/pinterest/data/getPinterestBoards";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { format } from "date-fns";
import {
  CalendarIcon,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Search,
  SendHorizontal,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import FilePreview from "../../renderFilePreview";
import { handleSocialMediaPost } from "./action/handleSocialMediaPost";
import { uploadMedia } from "./action/media/uploadMedia";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
} from "./constants/constants";
import NoAccountAvaible from "./NoAccountAvaible";
import { ImageUploads } from "./upload/ImageUpload ";
import { VideoCoverSelector } from "./upload/VideoCoverSelector";
import { VideoUploads } from "./upload/VideoUpload";

interface SocialPostFormProps {
  readonly accounts: SocialAccount[];
  readonly userId: string | null;
  readonly postType: "text" | "image" | "video";
  readonly uploadLimits?: { image: number; video: number };
  readonly planId?: string;
}

export default function SocialPostForm({
  accounts,
  userId,
  postType,
  uploadLimits,
  planId,
}: SocialPostFormProps) {
  // Content step state
  const [isScheduled, setIsScheduled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingBoards, setIsLoadingBoards] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const MAX_IMAGE_SIZE_BYTES = (uploadLimits?.image ?? 8) * 1024 * 1024;
  const MAX_VIDEO_SIZE_BYTES = (uploadLimits?.video ?? 8) * 1024 * 1024;
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [coverTimestamp, setCoverTimestamp] = useState<number>(0);

  // Add new single state for all account content
  const [accountContent, setAccountContent] = useState<
    {
      accountId: string;
      title: string;
      description: string;
      link: string;
      isCustomized: boolean;
    }[]
  >([]);

  // Add a temporary state for holding inputs in text tab
  const [textInputs, setTextInputs] = useState({
    title: "",
    description: "",
    link: "",
  });
  const [error, setError] = useState<string | null>(null);

  const [platformOptions, setPlatformOptions] = useState<PlatformOptions>({
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
      // Pas besoin d'autres options spécifiques pour LinkedIn
    },
  });

  // Scheduling state
  const [scheduledDate, setScheduledDate] = useState(
    format(new Date(Date.now() + 24 * 60 * 60 * 1000), "yyyy-MM-dd") // Default to tomorrow
  );
  const [scheduledTime, setScheduledTime] = useState("12:00"); // Default noon

  // Accounts step state
  const [searchQuery, setSearchQuery] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [checkedAccountIds, setCheckedAccountIds] = useState<string[]>([]);
  const [newBoardName, setNewBoardName] = useState("");
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  // Reset form state
  const resetForm = () => {
    setSelectedFile(null);
    setCoverTimestamp(0);

    setAccountContent([]);
    setTextInputs({
      title: "",
      description: "",
      link: "",
    });
    setSelectedAccounts({});

    setIsScheduled(false);
    setIsLoading(false);
    setIsLoadingBoards(false);
    setError(null);
    setPlatformOptions({
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
    });
    setScheduledDate(
      format(new Date(Date.now() + 24 * 60 * 60 * 1000), "yyyy-MM-dd")
    );
    setScheduledTime("12:00");
    setSearchQuery("");
    setBoards([]);
    setEditingAccounts({});
    setOpenTab(undefined);
    setCheckedAccountIds([]);
    setNewBoardName("");
    setIsCreatingBoard(false);
  };

  const [selectedAccounts, setSelectedAccounts] = useState<
    Record<string, boolean>
  >({});

  const selectedTikTokAccount = accounts.filter(
    (acc) => selectedAccounts[acc.id] === true && acc.platform === "tiktok"
  );

  const selectedPinterestAccount = accounts.filter(
    (acc) => selectedAccounts[acc.id] === true && acc.platform === "pinterest"
  );
  const selectedLinkedinAccount = accounts.filter(
    (acc) => selectedAccounts[acc.id] === true && acc.platform === "linkedin"
  );
  const selectedInstagramAccount = accounts.filter(
    (acc) => selectedAccounts[acc.id] === true && acc.platform === "instagram"
  );
  // For each Pinterest account ID, keep its board list
  const [boards, setBoards] = useState<
    {
      boardID: string;
      boardName: string;
      accountId: string;
      isSelected: boolean;
    }[]
  >([]);

  // Process accounts by platform with filtering
  // Add this new constant near your other state declarations
  const filteredAccounts = accounts.filter((account) => {
    // Skip platforms that don't support text posts when in text mode
    if (
      postType === "text" &&
      (account.platform === "pinterest" ||
        account.platform === "tiktok" ||
        account.platform === "instagram")
    ) {
      return false;
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const searchFields = [
        account.username,
        account.display_name,
        account.platform,
      ]
        .filter(Boolean)
        .map((field) => field?.toLowerCase());
      return searchFields.some((field) =>
        field?.includes(searchQuery.toLowerCase())
      );
    }

    return true;
  });

  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  // Account toggle handler
  const handleAccountToggle = (accountId: string) => {
    setSelectedAccounts((prev) => ({
      ...prev,
      [accountId]: !prev[accountId],
    }));
  };

  const handleCreateBoard = async (accountId: string) => {
    if (!newBoardName.trim()) {
      toast.error("Please enter a board name");
      return;
    }

    const account = accounts.find((acc) => acc.id === accountId);
    if (!account?.access_token) return;

    setIsCreatingBoard(true);

    try {
      const result = await createPinterestBoard(
        account.access_token,
        newBoardName
      );

      if (result) {
        toast.success("Board created successfully!");
        setNewBoardName("");

        // Remove the "no-boards" placeholder and refetch boards
        setBoards((prev) =>
          prev.filter(
            (b) => !(b.accountId === accountId && b.boardName === "no-boards")
          )
        );
        setCheckedAccountIds((prev) => prev.filter((id) => id !== accountId));

        // Trigger refetch
        loadPlatformSpecificData();
      } else {
        toast.error("Failed to create board");
      }
    } catch {
      toast.error("Error creating board");
    } finally {
      setIsCreatingBoard(false);
    }
  };
  // Load platform-specific data based on selected accounts
  // Change your loadPlatformSpecificData function to use useCallback
  const loadPlatformSpecificData = useCallback(() => {
    setIsLoadingBoards(true);

    // Get all selected Pinterest account IDs
    const pinterestIds = accounts
      .filter(
        (acc) =>
          acc.platform === "pinterest" && selectedAccounts[acc.id] === true
      )
      .map((acc) => acc.id);

    // Filter to only accounts that don't already have boards loaded
    const accountsToFetch = pinterestIds.filter(
      (accountId) =>
        !boards.some((board) => board.accountId === accountId) &&
        !checkedAccountIds.includes(accountId)
    );

    // If no accounts need fetching, just finish loading
    if (accountsToFetch.length === 0) {
      setIsLoadingBoards(false);
      return;
    }

    // Track how many accounts have completed processing
    let completedCount = 0;

    // Fetch boards only for accounts that don't have boards yet
    accountsToFetch.forEach(async (accountId) => {
      const account = accounts.find((acc) => acc.id === accountId);
      if (!account?.access_token) {
        completedCount++;
        if (completedCount === accountsToFetch.length) {
          setIsLoadingBoards(false);
        }
        return;
      }

      // Mark this account as checked BEFORE making the request
      setCheckedAccountIds((prev) => [...prev, accountId]);

      const result = await getPinterestBoards(account.access_token, userId);

      if (result.success && result.boards.length > 0) {
        // Account has boards - add them to state
        const formatedBoards = result.boards.map((board) => ({
          boardID: board.id,
          boardName: board.name,
          accountId: accountId,
          isSelected: false,
        }));

        setBoards((prevBoards) => [...prevBoards, ...formatedBoards]);
      } else {
        // Account has no boards OR there was an error - add placeholder to prevent re-fetching
        setBoards((prevBoards) => [
          ...prevBoards,
          {
            boardID: `no-boards-${accountId}`,
            boardName: "no-boards",
            accountId: accountId,
            isSelected: false,
          },
        ]);
      }

      // Mark as completed
      completedCount++;
      if (completedCount === accountsToFetch.length) {
        setIsLoadingBoards(false);
      }
    });
  }, [accounts, selectedAccounts, boards, checkedAccountIds]);

  // Add this useEffect to handle  content initialization
  useEffect(() => {
    const selectedAccountsList = accounts.filter(
      (acc) => selectedAccounts[acc.id]
    );

    if (selectedAccountsList.length === 0) return;

    const updatedAccountContent = selectedAccountsList.map((account) => {
      const existingContent = accountContent.find(
        (item) => item.accountId === account.id
      );

      if (existingContent) {
        // Only update non-customized accounts
        if (!existingContent.isCustomized) {
          return {
            ...existingContent,
            description: textInputs.description,
            title: textInputs.title,
            link:
              account.platform === "pinterest"
                ? platformOptions.pinterest?.link || ""
                : textInputs.link,
          };
        }
        return existingContent; // Skip customized accounts
      }

      return {
        accountId: account.id,
        title: textInputs.title,
        description: textInputs.description,
        link:
          account.platform === "pinterest"
            ? platformOptions.pinterest?.link || ""
            : textInputs.link,
        isCustomized: false,
      };
    });

    setAccountContent(updatedAccountContent);
  }, [selectedAccounts, textInputs, accounts, platformOptions]);

  useEffect(() => {
    const pinterestAccounts = accounts.filter(
      (acc) => selectedAccounts[acc.id] && acc.platform === "pinterest"
    );

    if (pinterestAccounts.length > 0) {
      loadPlatformSpecificData();
    }
  }, [selectedAccounts, accounts, loadPlatformSpecificData]);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [selectedFile]);

  const checksBeforeSubmission = () => {
    // Check user authentication
    if (!userId) {
      console.error("[checksBeforeSubmission]: User not authenticated");
      return {
        valid: false,
        message: "User not authenticated. Please sign in to continue.",
      };
    }

    // Check if there's at least one account selected
    const selectedAccountCount =
      Object.values(selectedAccounts).filter(Boolean).length;
    if (selectedAccountCount === 0) {
      console.error("[checksBeforeSubmission]: No accounts selected");
      return { valid: false, message: "Please select at least one account" };
    }

    // Media validation for image/video posts
    if (postType === "video" || postType === "image") {
      if (!selectedFile) {
        console.error("[checksBeforeSubmission]: Missing required media file");
        return {
          valid: false,
          message: `Please select a ${postType} file to upload`,
        };
      }

      // Additional type-specific validations
      if (postType === "image") {
        if (!ALLOWED_IMAGE_TYPES.includes(selectedFile.type)) {
          console.error(
            "[checksBeforeSubmission]: Invalid image format:",
            selectedFile.type
          );
          return {
            valid: false,
            message: "Please select a valid image file format (JPEG, PNG)",
          };
        }

        if (selectedFile.size > MAX_IMAGE_SIZE_BYTES) {
          console.error(
            "[checksBeforeSubmission]: Image exceeds size limit:",
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
            "[checksBeforeSubmission]: Invalid video format:",
            selectedFile.type
          );
          return {
            valid: false,
            message: "Please select a valid video file format (MP4, MOV)",
          };
        }

        if (selectedFile.size > MAX_VIDEO_SIZE_BYTES) {
          console.error(
            "[checksBeforeSubmission]: Video exceeds size limit:",
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

    // Scheduled date validation
    if (isScheduled) {
      if (!scheduledDate || !scheduledTime) {
        console.error("[checksBeforeSubmission]: Missing scheduled date/time");
        return {
          valid: false,
          message: "Please select both date and time for scheduling",
        };
      }

      const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
      if (scheduledDateTime < new Date()) {
        console.error(
          "[checksBeforeSubmission]: Scheduled time is in the past"
        );
        return {
          valid: false,
          message: "The scheduled date cannot be in the past",
        };
      }
    }

    // Pinterest-specific validation for board selection
    if (
      selectedPinterestAccount.length > 0 &&
      (postType === "video" || postType === "image")
    ) {
      const missingBoardAccount = selectedPinterestAccount.find(
        (account) =>
          !boards.some(
            (board) => board.accountId === account.id && board.isSelected
          )
      );

      if (missingBoardAccount) {
        console.error(
          "[checksBeforeSubmission]: Missing Pinterest board selection"
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

    // Additional cross-platform validation
    if (postType === "image" && selectedTikTokAccount.length > 0) {
      console.warn(
        "[checksBeforeSubmission]: TikTok doesn't support image posts"
      );
      return {
        valid: false,
        message:
          "TikTok doesn't support image posts. Please choose a different post type or unselect TikTok accounts.",
      };
    }

    return { valid: true };
  };

  // Fonction utilitaire pour convertir PNG en JPEG
  const convertPngToJpeg = (file: File, quality: number = 1): Promise<File> => {
    return new Promise((resolve, reject) => {
      const MAX_CONVERSION_SIZE = 100 * 1024 * 1024; // 100MB

      // Vérification de la taille pour éviter les crashes navigateur (limite technique)
      if (file.size > MAX_CONVERSION_SIZE) {
        reject(new Error(`Image too large `));

        return;
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context not available"));
        return;
      }
      const img = new Image();

      const timeout = setTimeout(() => {
        reject(new Error("Conversion timeout"));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(img.src);
      };

      img.onload = () => {
        cleanup();

        try {
          canvas.width = img.width;
          canvas.height = img.height;

          // Fond blanc pour remplacer la transparence PNG
          ctx!.fillStyle = "white";
          ctx!.fillRect(0, 0, canvas.width, canvas.height);

          // Dessiner l'image
          ctx!.drawImage(img, 0, 0);

          // Convertir en JPEG
          canvas.toBlob(
            (blob) => {
              if (blob) {
                const originalName = file.name;
                const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
                const jpegName = `${nameWithoutExt}.jpg`;

                const jpegFile = new File([blob], jpegName, {
                  type: "image/jpeg",
                  lastModified: Date.now(),
                });
                resolve(jpegFile);
              } else {
                reject(new Error("Conversion failed"));
              }
            },
            "image/jpeg",
            quality
          );
        } catch (error) {
          reject(
            new Error(
              `Canvas processing failed: ${
                error instanceof Error ? error.message : "Unknown error"
              }`
            )
          );
        }
      };

      img.onerror = () => {
        cleanup();
        reject(
          new Error("Failed to load image. Please try again or try later.")
        );
      };
      try {
        img.src = URL.createObjectURL(file);
      } catch {
        clearTimeout(timeout);
        reject(new Error("Failed to create object URL"));
      }
    });
  };
  // Unified submit function with enhanced security and error handling
  const handleSubmit = async () => {
    // Helper function to clean up media on error cases
    const cleanupMediaOnError = async (path: string) => {
      if (path && userId) {
        try {
          await deleteSupabaseFileAction(userId, path);
        } catch {
          // Intentionally empty - cleanup failures shouldn't disrupt main flow
        }
      }
    };
    // Step 1: Skip if already loading to prevent double submissions
    if (isLoading) return;

    // Step 2: Pre-submission validation
    const validationResult = checksBeforeSubmission();
    if (!validationResult.valid) {
      setError(
        validationResult.message || "Please fix the errors before continuing."
      );
      toast.error(
        validationResult.message || "Please fix the errors before continuing."
      );
      return;
    }

    // Step 3: Set loading state and reset errors/progress
    setIsLoading(true);
    setError(null);
    setUploadProgress(0);

    // Create a unique batch ID for this submission
    const batchId = nanoid(32);
    let mediaStoragePath = "";

    try {
      // Step 4: Handle media upload if needed
      if ((postType === "video" || postType === "image") && selectedFile) {
        // Validate file size again (security)
        const maxSize =
          postType === "image" ? MAX_IMAGE_SIZE_BYTES : MAX_VIDEO_SIZE_BYTES;
        if (selectedFile.size > maxSize) {
          setError(
            `File exceeds maximum size limit of ${maxSize / (1024 * 1024)}MB.`
          );
          setIsLoading(false);
          return;
        }

        // Start upload with progress tracking

        const uploadResult = await uploadMedia(
          selectedFile,
          isScheduled,
          planId,
          (progress) => {
            setUploadProgress(progress);
          }
        );

        if (!uploadResult.success) {
          toast.error(uploadResult.message || "Failed to upload media");
          setError(uploadResult.message || "Failed to upload media");
          setIsLoading(false);
          return;
        }

        mediaStoragePath = uploadResult.path ?? "";
      }

      // Step 5: Ensure account content is properly set before submission
      if (accountContent.length === 0) {
        setError("No content found for selected accounts.");
        setIsLoading(false);

        await cleanupMediaOnError(mediaStoragePath);
        return;
      }

      // Step 6: Call the unified server function for posting/scheduling

      const result = await handleSocialMediaPost({
        // Platform-specific accounts
        pinterestAccounts: selectedPinterestAccount,
        linkedinAccounts: selectedLinkedinAccount,
        tiktokAccounts: selectedTikTokAccount,
        instagramAccounts: selectedInstagramAccount,

        // Media info
        mediaPath: mediaStoragePath,
        coverTimestamp: coverTimestamp,
        fileName: selectedFile?.name,

        // Content details
        boards,
        platformOptions,
        accountContent,

        // Post configuration
        isScheduled,
        scheduledDate: isScheduled ? scheduledDate : undefined,
        scheduledTime: isScheduled ? scheduledTime : undefined,
        postType,

        // Identifiers
        userId,
        batchId,

        // Clean up files after processing (for direct posts only)
        cleanupFiles: !isScheduled,
      });

      // Step 7: Handle response with detailed error processing

      if (result.success) {
        // Success case - all or some accounts succeeded
        toast.success(
          result.message ||
            `Successfully ${
              isScheduled ? "scheduled" : "published"
            } your content!`
        );

        // If there were partial failures, show additional warning
        if (result.errors && result.errors.length > 0) {
          setTimeout(() => {
            toast.warning(
              `Note: ${result.errors?.length} account(s) had issues.  See details for more information.`
            );
          }, 500);
        }

        // Reset the form to initial state on success
        resetForm();
      } else if (result.resetIn) {
        toast.error(
          `You've reached the posting limit. Please try again in ${result.resetIn} seconds.`
        );

        // Clean up unused media on complete failure
        if (!result.counts || result.counts.total === 0) {
          await cleanupMediaOnError(mediaStoragePath);
        }
      } else {
        // General error case
        setError(result.message);
        toast.error(result.message);

        // Show detailed errors if available
        if (result.errors && result.errors.length > 0) {
          // Show first error for user context if not shown in the main message
          if (!result.message) {
            // Extract just the error message without technical details
            const firstError = result.errors[0];
            const friendlyError = firstError.error.includes(":")
              ? firstError.error.split(":")[0].trim()
              : firstError.error;

            toast.error(
              `Problem with ${firstError.platform}: ${friendlyError}`
            );
          }
        }

        // Clean up media on complete failure
        if (!result.counts || result.counts.total === 0) {
          await cleanupMediaOnError(mediaStoragePath);
        }
      }
    } catch {
      setError("Something went wrong. Please try again later.");

      // Clean up media file on error
      await cleanupMediaOnError(mediaStoragePath);
    } finally {
      // Step 9: Always reset loading state
      setIsLoading(false);
    }
  };

  // New state for tracking which accounts are in edit mode
  const [editingAccounts, setEditingAccounts] = useState<
    Record<string, boolean>
  >({});
  const [openTab, setOpenTab] = useState<string | undefined>(undefined);
  const CAPTION_LIMITS = {
    default: 2200,
    twitter: 280,
    facebook: 63206,
    instagram: 2200,
    linkedin: 3000,
    pinterest: 500,
    tiktok: 2200,
  };
  return (
    <>
      {/**No accounts avaible */}
      {accounts.length === 0 && <NoAccountAvaible />}

      {accounts.length !== 0 && (
        <>
          <SidebarGroup className="flex-1   lg:w-4/6 space-y-6">
            {/* Account selection section */}
            <div>
              <div className="flex-grow space-y-4">
                {/* Search bar */}
                <div className="relative">
                  {!isSearchExpanded ? (
                    // Collapsed state - compact button
                    <div className="inline-block ">
                      <button
                        onClick={() => setIsSearchExpanded(true)}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-all duration-300 ease-in-out"
                      >
                        <Search className="h-3 w-3" />
                        <span>Search & Filter</span>
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    // Expanded state - button and search bar
                    <div className="flex flex-col gap-2">
                      <div className="inline-block">
                        <button
                          onClick={() => setIsSearchExpanded(false)}
                          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-all duration-300 ease-in-out"
                        >
                          <Search className="h-3 w-3" />
                          <span>Search & Filter</span>
                          <ChevronUp className="h-3 w-3" />
                        </button>
                      </div>

                      <div className=" bg-white border rounded-lg relative w-full transition-all duration-500 ease-out origin-top transform animate-in fade-in-0 slide-in-from-top-2">
                        <Input
                          placeholder="Search accounts..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full border-[0.5px] focus:ring-0 focus:border-gray-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-gray-300"
                          autoFocus
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Account grid */}
                <div className="flex flex-row flex-wrap gap-4">
                  {filteredAccounts.map((account) => (
                    <div
                      key={`grid-${account.id}`}
                      className="relative cursor-pointer group"
                      onClick={() => handleAccountToggle(account.id)}
                    >
                      <div
                        className={`
                          relative transition-all duration-100
                          ${
                            !selectedAccounts[account.id]
                              ? "grayscale opacity-60 hover:opacity-80"
                              : "grayscale-0 opacity-100"
                          }
                        `}
                      >
                        <SocialAvatarWrapper
                          src={account.avatar_url}
                          alt={account.username ?? "Account"}
                          platform={account.platform}
                          className="h-12 w-12"
                          size={48}
                          isSelected={!!selectedAccounts[account.id]}
                        />
                      </div>
                      <div>{account.display_name ?? account.username}</div>
                      {/* Tooltip with account name on hover */}
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                        {account.display_name ?? account.username}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/*video content*/}
            {postType === "video" && !selectedFile && (
              <VideoUploads
                maxSizeMB={uploadLimits?.video ?? 50}
                onFileSelected={(file) => {
                  // Do any validation here
                  const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
                  if (!isVideo) {
                    setError("Please select a valid video (MP4, MOV) file.");
                    return;
                  }

                  if (file.size > MAX_VIDEO_SIZE_BYTES) {
                    setError(
                      `File size exceeds the maximum limit of ${uploadLimits?.video}MB.`
                    );
                    return;
                  }

                  setSelectedFile(file);
                  setError(null);
                }}
              />
            )}
            {/*cover*/}
            {postType === "video" && selectedFile && (
              <VideoCoverSelector
                videoFile={selectedFile}
                onCoverChange={setCoverTimestamp}
                onError={setError}
              />
            )}
            {/*image content*/}

            {postType === "image" && !selectedFile && (
              <ImageUploads
                maxSizeMB={uploadLimits?.image ?? 8}
                onFileSelected={async (file) => {
                  // Do any validation here
                  const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);

                  if (!isImage) {
                    setError("Please select a valid image (JPEG, PNG) file.");
                    return;
                  }
                  // Auto-conversion PNG → JPEG pour Instagram

                  let finalFile = file;

                  // Conversion PNG → JPEG si nécessaire (avec gestion d'erreur)
                  if (file.type === "image/png") {
                    try {
                      finalFile = await convertPngToJpeg(file);
                    } catch (conversionError) {
                      const errorMessage =
                        conversionError instanceof Error
                          ? conversionError.message
                          : "Failed to convert image";
                      setError(`Image conversion failed: ${errorMessage}`);
                      return;
                    }
                  }

                  if (finalFile.size > MAX_IMAGE_SIZE_BYTES) {
                    setError(
                      `File size exceeds the maximum limit of ${uploadLimits?.image}MB.`
                    );
                    return;
                  }

                  setSelectedFile(finalFile);
                  setError(null);
                }}
              />
            )}
            {/* caption field */}

            <Label htmlFor="text-content">
              {postType === "text" ? "Content" : "Caption"}
            </Label>
            <div>
              <Textarea
                id="text-content"
                value={textInputs.description}
                onChange={(e) =>
                  setTextInputs({
                    ...textInputs,
                    description: e.target.value.slice(
                      0,
                      CAPTION_LIMITS.default
                    ),
                  })
                }
                placeholder={
                  postType === "text"
                    ? "Write your post content here"
                    : "Write a caption for your post"
                }
                className="max-h-60 overflow-y-auto  bg-white"
                maxLength={CAPTION_LIMITS.default}
                rows={6}
                required
              />
              <div className="text-xs text-right text-muted-foreground">
                {textInputs.description.length} / {CAPTION_LIMITS.default}{" "}
                characters
              </div>
            </div>

            {/* Post details section */}
            {(postType === "video" || postType === "image") && (
              <>
                {/* For multiple accounts - show default caption and tabs */}
                {(selectedPinterestAccount.length > 0 ||
                  Object.values(selectedAccounts).filter(Boolean).length >
                    1) && (
                  <>
                    {/* Tabs for customization - with toggle behavior */}

                    <Tabs
                      value={openTab}
                      onValueChange={(value) => {
                        // If we're clicking the currently open tab, close it by setting undefined
                        if (openTab === value) {
                          setOpenTab(undefined);
                        } else {
                          // Otherwise, open the clicked tab
                          setOpenTab(value);
                        }
                      }}
                      defaultValue={
                        selectedPinterestAccount.length === 1 &&
                        Object.values(selectedAccounts).filter(Boolean)
                          .length === 1
                          ? "pinterest"
                          : undefined
                      }
                    >
                      <TabsList>
                        {!(
                          selectedPinterestAccount.length === 1 &&
                          Object.values(selectedAccounts).filter(Boolean)
                            .length === 1
                        ) && (
                          <TabsTrigger
                            value="captions"
                            className=" cursor-pointer"
                          >
                            Custom Captions
                          </TabsTrigger>
                        )}
                        {selectedPinterestAccount.length > 0 && (
                          <TabsTrigger
                            value="pinterest"
                            className=" cursor-pointer "
                          >
                            Pinterest Settings
                          </TabsTrigger>
                        )}
                      </TabsList>

                      {/* Custom Captions Tab */}
                      <TabsContent value="captions" className="mt-4">
                        <div className="space-y-4">
                          {accounts
                            .filter((account) => selectedAccounts[account.id])
                            .map((account) => {
                              const accountData = accountContent.find(
                                (item) => item.accountId === account.id
                              );
                              const isCustomized =
                                accountData?.isCustomized || false;
                              const isEditing =
                                editingAccounts[account.id] || false;

                              return (
                                <div
                                  key={`caption-${account.id}`}
                                  className="border rounded p-3"
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <AvatarWithFallback
                                        src={account.avatar_url}
                                        alt={account.username ?? "Account"}
                                        size={42}
                                        className="h-8 w-8"
                                      />
                                      <span className="font-medium">
                                        {account.display_name ??
                                          account.username}
                                      </span>
                                      {isCustomized && (
                                        <span className="text-xs text-muted-foreground">
                                          (Customized)
                                        </span>
                                      )}
                                    </div>
                                    <Button
                                      className="cursor-pointer"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        if (isEditing || isCustomized) {
                                          // Clear button - revert to default
                                          const defaultContent =
                                            accountContent.find(
                                              (item) => !item.isCustomized
                                            );
                                          setAccountContent((prev) =>
                                            prev.map((item) =>
                                              item.accountId === account.id
                                                ? {
                                                    ...item,
                                                    isCustomized: false,
                                                    description:
                                                      defaultContent?.description ||
                                                      "",
                                                    title:
                                                      defaultContent?.title ||
                                                      "",
                                                  }
                                                : item
                                            )
                                          );
                                          setEditingAccounts((prev) => ({
                                            ...prev,
                                            [account.id]: false,
                                          }));
                                        } else {
                                          // Edit button - enable editing
                                          setEditingAccounts((prev) => ({
                                            ...prev,
                                            [account.id]: true,
                                          }));
                                        }
                                      }}
                                    >
                                      {isEditing || isCustomized
                                        ? "Clear"
                                        : "Edit"}
                                    </Button>
                                  </div>

                                  <div className="space-y-2 bg-white border rounded-lg ">
                                    <Textarea
                                      value={accountData?.description || ""}
                                      onChange={(e) => {
                                        if (isEditing) {
                                          // Apply the platform-specific character limit
                                          const platformLimit =
                                            CAPTION_LIMITS[
                                              account.platform as keyof typeof CAPTION_LIMITS
                                            ] || CAPTION_LIMITS.default;
                                          setAccountContent((prev) =>
                                            prev.map((item) =>
                                              item.accountId === account.id
                                                ? {
                                                    ...item,
                                                    description:
                                                      e.target.value.slice(
                                                        0,
                                                        platformLimit
                                                      ),
                                                    isCustomized: true,
                                                  }
                                                : item
                                            )
                                          );
                                        }
                                      }}
                                      placeholder="Caption for this account"
                                      rows={3}
                                      disabled={!isEditing}
                                      className={`max-h-40 overflow-y-auto ${
                                        !isEditing ? "bg-muted/20" : "bg-white"
                                      }`}
                                      maxLength={
                                        CAPTION_LIMITS[
                                          account.platform as keyof typeof CAPTION_LIMITS
                                        ] || CAPTION_LIMITS.default
                                      }
                                    />
                                    {isEditing && (
                                      <div className="text-xs text-right text-muted-foreground">
                                        {accountData?.description?.length || 0}{" "}
                                        /{" "}
                                        {CAPTION_LIMITS[
                                          account.platform as keyof typeof CAPTION_LIMITS
                                        ] || CAPTION_LIMITS.default}{" "}
                                        characters
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </TabsContent>

                      {/* Pinterest Settings Tab */}
                      {selectedPinterestAccount.length > 0 && (
                        <TabsContent value="pinterest" className="mt-4">
                          <div className="space-y-4  ">
                            {/* Board selection for each Pinterest account */}
                            {selectedPinterestAccount.map((account) => (
                              <div
                                key={`pinterest-${account.id}`}
                                className="space-y-3 border rounded p-3 bg-[#e6e6e1]"
                              >
                                <div className="flex items-center gap-2">
                                  <AvatarWithFallback
                                    src={account.avatar_url}
                                    alt={account.username ?? "Account"}
                                    size={42}
                                    className="h-8 w-8"
                                  />
                                  <span className="font-medium">
                                    {account.display_name ?? account.username}
                                  </span>
                                </div>

                                {isLoadingBoards && (
                                  <div className="p-2 border rounded-md text-gray-500">
                                    Loading boards...
                                  </div>
                                )}

                                {!isLoadingBoards &&
                                  boards.some(
                                    (board) =>
                                      board.accountId === account.id &&
                                      board.boardName === "no-boards"
                                  ) && (
                                    <div className="flex gap-2 bg-white">
                                      <Input
                                        placeholder="Board name"
                                        value={newBoardName}
                                        onChange={(e) =>
                                          setNewBoardName(e.target.value)
                                        }
                                        disabled={isCreatingBoard}
                                      />
                                      <Button
                                        onClick={() =>
                                          handleCreateBoard(account.id)
                                        }
                                        disabled={
                                          isCreatingBoard ||
                                          !newBoardName.trim()
                                        }
                                      >
                                        {isCreatingBoard ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          "Create"
                                        )}
                                      </Button>
                                    </div>
                                  )}

                                {!isLoadingBoards &&
                                  boards.some(
                                    (board) =>
                                      board.accountId === account.id &&
                                      board.boardName === "error"
                                  ) && (
                                    <div className="p-2 border rounded-md bg-white text-red-500">
                                      Error loading boards for this account.
                                      Please try reconnecting.
                                    </div>
                                  )}

                                {!isLoadingBoards &&
                                  boards.filter(
                                    (board) => board.accountId === account.id
                                  ).length > 0 && (
                                    <Select
                                      value={
                                        boards.find(
                                          (b) =>
                                            b.accountId === account.id &&
                                            b.isSelected
                                        )?.boardID ?? ""
                                      }
                                      onValueChange={(boardId) => {
                                        setBoards((prevBoards) =>
                                          prevBoards.map((board) => ({
                                            ...board,
                                            isSelected:
                                              board.accountId === account.id
                                                ? board.boardID === boardId
                                                : board.isSelected,
                                          }))
                                        );
                                      }}
                                    >
                                      <SelectTrigger className="bg-white">
                                        <SelectValue placeholder="Select a board" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {boards
                                          .filter(
                                            (board) =>
                                              board.accountId === account.id &&
                                              board.boardName !== "no-boards" &&
                                              board.boardName !== "error"
                                          )
                                          .map((board) => (
                                            <SelectItem
                                              key={`${account.id}-${board.boardID}`}
                                              value={board.boardID}
                                            >
                                              {board.boardName}
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                              </div>
                            ))}
                            {/* Single title field for all Pinterest accounts */}
                            <div className="space-y-2 mb-4 ">
                              <Label htmlFor="pinterest-title">
                                Title (Optional)
                              </Label>
                              <Input
                                id="pinterest-title"
                                value={textInputs.title}
                                onChange={(e) => {
                                  // Update the main textInputs state
                                  setTextInputs((prev) => ({
                                    ...prev,
                                    title: e.target.value,
                                  }));

                                  // Update all Pinterest account titles at once
                                  setAccountContent((prev) =>
                                    prev.map((item) =>
                                      selectedPinterestAccount.some(
                                        (acc) => acc.id === item.accountId
                                      )
                                        ? { ...item, title: e.target.value }
                                        : item
                                    )
                                  );
                                }}
                                className="bg-white"
                                placeholder="Add a title for all Pinterest pins"
                              />
                            </div>
                            {/* Single link field for all Pinterest accounts */}
                            <div className="space-y-2 ">
                              <Label htmlFor="pinterest-link">
                                Link (Optional)
                              </Label>
                              <Input
                                id="pinterest-link"
                                type="url"
                                value={platformOptions.pinterest?.link ?? ""}
                                onChange={(e) => {
                                  setPlatformOptions((prev) => ({
                                    ...prev,
                                    pinterest: {
                                      ...prev.pinterest!,
                                      link: e.target.value,
                                    },
                                  }));
                                }}
                                placeholder="https://example.com"
                                className="bg-white"
                              />
                            </div>
                          </div>
                        </TabsContent>
                      )}
                    </Tabs>
                  </>
                )}
              </>
            )}
          </SidebarGroup>

          <SidebarGroup className="w-full  lg:w-2/6 space-y-6">
            {/* Preview panel */}
            {selectedFile && (
              <div className="border rounded-2xl  bg-white ">
                <div className="p-5">
                  <h1 className="mb-3">Media Preview</h1>
                  <div className="rounded-lg overflow-hidden bg-white relative">
                    <FilePreview
                      selectedFile={selectedFile}
                      mediaType={postType}
                      previewUrl={previewUrl}
                    />
                  </div>
                </div>
              </div>
            )}

            {/**Scheduling button */}
            <div className=" p-2.5 border rounded-2xl  bg-white">
              {/* Scheduling toggle */}
              <div className="flex items-center  space-x-2 py-2">
                <Switch
                  id="schedule-toggle"
                  checked={isScheduled}
                  onCheckedChange={setIsScheduled}
                />
                <Label htmlFor="schedule-toggle">Schedule for later</Label>
              </div>

              {/* Scheduling options */}
              {isScheduled && (
                <div className="grid gap-4 py-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="schedule-date">Date</Label>
                      <Input
                        id="schedule-date"
                        type="date"
                        value={scheduledDate}
                        min={format(new Date(), "yyyy-MM-dd")}
                        onChange={(e) => setScheduledDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="schedule-time">Time</Label>
                      <Input
                        id="schedule-time"
                        type="time"
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground flex items-center">
                    <Clock className="mr-2 h-4 w-4" />
                    Will be posted on{" "}
                    {format(
                      new Date(`${scheduledDate}T${scheduledTime}`),
                      "PPP 'at' p"
                    )}
                  </div>
                </div>
              )}

              {/* Error display */}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {selectedFile && isLoading && (
                <div className="mt-2">
                  <p className="text-sm text-muted-foreground mb-1">
                    Uploading: {uploadProgress}%
                  </p>
                  <div className="w-full bg-muted rounded-full h-2.5">
                    <div
                      className="bg-primary h-2.5 rounded-full"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {!isLoading && (
                <div className="pt-4 flex justify-between">
                  <Button
                    onClick={handleSubmit}
                    disabled={
                      isLoading ||
                      Object.values(selectedAccounts).filter(Boolean).length ===
                        0
                    }
                    className="w-full"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {isScheduled ? "Scheduling..." : "Publishing..."}
                      </>
                    ) : (
                      <>
                        {isScheduled ? (
                          <>
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            Schedule Post
                          </>
                        ) : (
                          <>
                            <SendHorizontal className="mr-2 h-4 w-4" />
                            Publish Now
                          </>
                        )}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </SidebarGroup>
        </>
      )}
    </>
  );
}
