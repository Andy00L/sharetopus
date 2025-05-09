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
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import FilePreview from "../../renderFilePreview";
import { generateState } from "../accounts/ConnectSocialAccounts/generateState";
import { directPostForLinkedInAccounts } from "./action/Direct/directPostForLinkedInAccounts";
import { directPostForPinterestAccounts } from "./action/Direct/directPostForPinterestAccounts";
import { directPostForTikTokAccounts } from "./action/Direct/directPostForTikTokAccounts";
import { uploadMedia } from "./action/media/uploadMedia";
import { scheduleForLinkedInAccounts } from "./action/Scheduled/scheduledForLinkedinAccounts";
import {
  scheduleForPinterestAccounts,
  ScheduleResult,
} from "./action/Scheduled/scheduleForPinterestAccounts";
import { scheduleForTikTokAccounts } from "./action/Scheduled/scheduleForTikTokAccounts";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_IMAGE_SIZE_MB,
  MAX_VIDEO_SIZE_BYTES,
  MAX_VIDEO_SIZE_MB,
} from "./constants/constants";
import NoAccountAvaible from "./NoAccountAvaible";
import { ImageUpload } from "./upload/ImageUploadCard";
import { VideoUpload } from "./upload/VideoUploadCard";

interface SocialPostFormProps {
  readonly accounts: SocialAccount[];
  readonly userId: string | null;
  readonly postType: "text" | "image" | "video";
}

export default function SocialPostForm({
  accounts,
  userId,
  postType,
}: SocialPostFormProps) {
  // Content step state
  const [isDragging, setIsDragging] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingBoards, setIsLoadingBoards] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

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
  // Processing state
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Accounts step state
  const [searchQuery, setSearchQuery] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Reset form state
  const resetForm = () => {
    setSelectedFile(null);
    setAccountContent([]);
    setTextInputs({
      title: "",
      description: "",
      link: "",
    });
    setAccountContent([]);
    setSelectedAccounts({});

    setIsDragging(false);
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
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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

    // Skip TikTok for image uploads
    if (postType === "image" && account.platform === "tiktok") {
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

  // Handle file selection for upload
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Determine if image or video
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);

    // File validation
    if (!isImage && !isVideo) {
      setError(
        "Please select a valid image (JPEG, PNG) or video (MP4, MOV) file."
      );
      return;
    }

    // Check file size
    const sizeLimit = isImage ? MAX_IMAGE_SIZE_BYTES : MAX_VIDEO_SIZE_BYTES;
    const sizeLimitMB = isImage ? MAX_IMAGE_SIZE_MB : MAX_VIDEO_SIZE_MB;

    if (file.size > sizeLimit) {
      setError(`File size exceeds the maximum limit of ${sizeLimitMB}MB.`);
      return;
    }

    // Set file and media type
    setSelectedFile(file);
    setError(null);
    // Generate thumbnail if it's a video
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    // File validation
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);

    if (!isImage && !isVideo) {
      setError(
        "Please select a valid image (JPEG, PNG) or video (MP4, MOV) file."
      );
      return;
    }

    // Size validation
    const sizeLimit = isImage ? MAX_IMAGE_SIZE_BYTES : MAX_VIDEO_SIZE_BYTES;
    const sizeLimitMB = isImage ? MAX_IMAGE_SIZE_MB : MAX_VIDEO_SIZE_MB;

    if (file.size > sizeLimit) {
      setError(`File size exceeds the maximum limit of ${sizeLimitMB}MB.`);
      return;
    }

    setSelectedFile(file);
    setError(null);
  };

  // Account toggle handler
  const handleAccountToggle = (accountId: string) => {
    setSelectedAccounts((prev) => ({
      ...prev,
      [accountId]: !prev[accountId],
    }));
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
      (accountId) => !boards.some((board) => board.accountId === accountId)
    );

    // If no accounts need fetching, just finish loading
    if (accountsToFetch.length === 0) {
      setIsLoadingBoards(false);
      return;
    }

    // Fetch boards only for accounts that don't have boards yet
    accountsToFetch.forEach(async (accountId) => {
      const account = accounts.find((acc) => acc.id === accountId);
      if (!account?.access_token) return;

      const fetchedBoards = await getPinterestBoards(account.access_token);

      const formatedBoards = fetchedBoards.map((board) => ({
        boardID: board.id,
        boardName: board.name,
        accountId: accountId,
        isSelected: false,
      }));

      setBoards((prevBoards) => {
        const existingBoardIds = new Set(
          prevBoards
            .filter((board) => board.accountId === accountId)
            .map((board) => board.boardID)
        );

        const newBoards = formatedBoards.filter(
          (board) => !existingBoardIds.has(board.boardID)
        );
        // Keep existing boards and add new ones
        return [...prevBoards, ...newBoards];
      });
      setIsLoadingBoards(false);
    });
  }, [accounts, selectedAccounts, boards]);

  // Add this useEffect to handle account content initialization
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
            link: textInputs.link,
          };
        }
        return existingContent; // Skip customized accounts
      }

      return {
        accountId: account.id,
        title: textInputs.title,
        description: textInputs.description,
        link: textInputs.link,
        isCustomized: false,
      };
    });

    setAccountContent(updatedAccountContent);
  }, [selectedAccounts, textInputs, accounts]);

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
    // Basic validation
    if (!userId) {
      toast.error("User not authenticated.");
      resetForm();
      setError("User not authenticated. Please log in again.");
      return false;
    }

    // Check if there's at least one account selected
    if (Object.values(selectedAccounts).filter(Boolean).length === 0) {
      setError("Please select at least one account");
      return false;
    }

    // Media validation
    if (postType === "video" || postType === "image") {
      if (!selectedFile) {
        setError("Please select a file to upload");
        return false;
      }
    }

    // Check if captions are provided (required for images only)
    if (postType === "text") {
      // Text post validation - we already have content from step 1
      const missingTitle = accountContent.some(
        (item) => !item.description.trim()
      );
      if (missingTitle) {
        setError("Please enter a caption");
        return false;
      }
    }

    if (!postType) {
      return false;
    }
    if (
      isScheduled &&
      new Date(`${scheduledDate}T${scheduledTime}`) < new Date()
    ) {
      setError("The scheduled date cannot be in the past");
      return false;
    }

    // Pinterest-specific validation
    if (
      selectedPinterestAccount.length > 0 &&
      (postType === "video" || postType === "image")
    ) {
      const unselectedAccount = selectedPinterestAccount.find(
        (account) =>
          !boards.some(
            (board) => board.accountId === account.id && board.isSelected
          )
      );

      if (unselectedAccount) {
        setError(
          `Please select a Pinterest board for ${
            unselectedAccount.display_name ?? unselectedAccount.username
          }`
        );
        return false;
      }
    }

    return true;
  };

  const handleSchedueleSubmit = async () => {
    if (!checksBeforeSubmission()) return;
    setIsLoading(true);
    setError(null);
    setUploadProgress(0);

    let mediaStoragePath = "";
    let batchId = "";

    try {
      batchId = generateState();
      // 2. Téléchargement du média (si nécessaire)
      if ((postType === "video" || postType === "image") && selectedFile) {
        const uploadResult = await uploadMedia(selectedFile, (progress) => {
          setUploadProgress(progress); // Update progress state
        });

        if (!uploadResult.success) {
          toast(uploadResult.message);
        }

        mediaStoragePath = uploadResult.path ?? "";
      }

      // 3. Traitement des comptes Pinterest
      const pinterestResult = await scheduleForPinterestAccounts({
        accounts: selectedPinterestAccount,
        mediaPath: mediaStoragePath,
        boards,
        platformOptions,
        scheduledDate,
        scheduledTime,
        // Just filter accountContent to only include Pinterest accounts
        accountContent: accountContent.filter((item) =>
          selectedPinterestAccount.some((acc) => acc.id === item.accountId)
        ),
        batchId,
        postType,
        userId,
      });

      if (!pinterestResult.success) {
        toast(pinterestResult.message);
      }

      const tiktokResult = await scheduleForTikTokAccounts({
        accounts: selectedTikTokAccount,
        mediaPath: mediaStoragePath,
        platformOptions,
        scheduledDate,
        scheduledTime,
        // Just filter accountContent to only include Pinterest accounts
        accountContent: accountContent.filter((item) =>
          selectedTikTokAccount.some((acc) => acc.id === item.accountId)
        ),
        postType,
        batchId,
        userId,
      });
      if (!tiktokResult.success) {
        toast(tiktokResult.message);
      }

      const linkedinResult = await scheduleForLinkedInAccounts({
        accounts: selectedLinkedinAccount,
        mediaPath: mediaStoragePath,
        platformOptions,
        scheduledDate,
        scheduledTime,
        // Just filter accountContent to only include Pinterest accounts
        accountContent: accountContent.filter((item) =>
          selectedLinkedinAccount.some((acc) => acc.id === item.accountId)
        ),
        batchId,
        postType,
        userId,
      });

      if (!linkedinResult.success) {
        toast(linkedinResult.message);
      }

      const totalSuccessCount =
        pinterestResult.count + tiktokResult.count + linkedinResult.count;

      // 4. Notification de succès
      if (totalSuccessCount > 0) {
        toast.success(`${totalSuccessCount} post(s) scheduled successfully!`);
        resetForm();
      } else {
        toast.info("No posts were scheduled.");
      }
    } catch (error) {
      console.error("Form submission error:", error);
      setError("Failed to publish post");

      // Nettoyage des fichiers si nécessaire
      if (mediaStoragePath && (postType === "video" || postType === "image")) {
        try {
          await deleteSupabaseFileAction(mediaStoragePath, userId);
        } catch (deleteError) {
          console.error("Failed to clean up file:", deleteError);
        }
      }
    }

    setIsLoading(false);
  };

  const handleDirectPostSubmit = async () => {
    // Initial validation of form fields
    if (!checksBeforeSubmission()) return;

    setIsLoading(true);
    setError(null);
    setUploadProgress(0);

    // Declare result variables at function scope
    let pinterestResult: ScheduleResult = {
      success: false,
      count: 0,
      message: "",
    };
    let linkedinResult: ScheduleResult = {
      success: false,
      count: 0,
      message: "",
    };
    let tiktokResult: ScheduleResult = {
      success: false,
      count: 0,
      message: "",
    };

    let mediaPath = "";
    let batchId = "";
    try {
      batchId = generateState();

      // Upload media file if needed (only for media tab)
      if ((postType === "video" || postType === "image") && selectedFile) {
        const uploadResult = await uploadMedia(selectedFile, (progress) => {
          setUploadProgress(progress);
        });

        if (!uploadResult.success) {
          toast(uploadResult.message ?? "Failed to upload media");
        }

        mediaPath = uploadResult.path ?? "";
        if (selectedPinterestAccount.length > 0) {
          // ───────────────── Pinterest ─────────────────
          pinterestResult = await directPostForPinterestAccounts({
            accounts: selectedPinterestAccount,
            mediaPath: mediaPath,
            boards,
            platformOptions,
            accountContent: accountContent.filter((item) =>
              selectedPinterestAccount.some((acc) => acc.id === item.accountId)
            ),
            batchId: batchId,
            userId, // Added userId parameter which is required
            fileName: selectedFile.name,
          });

          if (!pinterestResult.success) {
            toast.error(
              pinterestResult.message ?? "Failed to post to Pinterest"
            );
          }
        }
        if (selectedTikTokAccount.length > 0) {
          // ───────────────── TikTok ───────────────────
          tiktokResult = await directPostForTikTokAccounts({
            accounts: selectedTikTokAccount,
            mediaPath: mediaPath,
            platformOptions,
            accountContent: accountContent.filter((item) =>
              selectedTikTokAccount.some((acc) => acc.id === item.accountId)
            ),
            batchId: batchId,
            userId,
            fileName: selectedFile.name,
          });

          if (!tiktokResult.success) {
            toast.error(tiktokResult.message ?? "Failed to post to TikTok");
          }
        }
      }

      // Process LinkedIn posts (for both media and text tabs)
      if (selectedLinkedinAccount.length > 0) {
        // ───────────────── Linkedin ────────────────────
        linkedinResult = await directPostForLinkedInAccounts({
          accounts: selectedLinkedinAccount,
          mediaPath:
            (postType === "video" || postType === "image") && mediaPath
              ? mediaPath
              : "",
          platformOptions,
          accountContent: accountContent.filter((item) =>
            selectedLinkedinAccount.some((acc) => acc.id === item.accountId)
          ),
          batchId: batchId,
          userId,
          fileName: selectedFile?.name,
        });

        if (!linkedinResult.success) {
          toast.error(linkedinResult.message ?? "Failed to post to LinkedIn");
        }
      }

      // Remove the complex separator code and replace with this simpler approach
      const totalSuccessCount =
        (pinterestResult.success ? pinterestResult.count : 0) +
        (linkedinResult.success ? linkedinResult.count : 0) +
        (tiktokResult.success ? tiktokResult.count : 0);

      // Show success notification only if we had successful posts
      if (totalSuccessCount > 0) {
        const successMessages = [];

        if (pinterestResult.success && pinterestResult.count > 0) {
          successMessages.push(`${pinterestResult.count} post(s) on Pinterest`);
        }

        if (linkedinResult.success && linkedinResult.count > 0) {
          successMessages.push(`${linkedinResult.count} post(s) on LinkedIn`);
        }

        if (tiktokResult.success && tiktokResult.count > 0) {
          successMessages.push(`${tiktokResult.count} post(s) on TikTok`);
        }

        // Join with commas and 'and' for the last item
        let successMsg = "";
        if (successMessages.length === 1) {
          successMsg = successMessages[0];
        } else if (successMessages.length === 2) {
          successMsg = successMessages.join(" and ");
        } else if (successMessages.length > 2) {
          const lastItem = successMessages.pop();
          successMsg = successMessages.join(", ") + ", and " + lastItem;
        }

        toast.success(`${successMsg} published successfully!`);
        resetForm();
      } else if (totalSuccessCount === 0) {
        toast.info("No posts were published.");
      }
    } catch (error) {
      console.error("Direct post submission error:", error);
      setError("Failed to publish post");
    }

    setIsLoading(false);
  };

  // New state for tracking which accounts are in edit mode
  const [editingAccounts, setEditingAccounts] = useState<
    Record<string, boolean>
  >({});
  const [openTab, setOpenTab] = useState<string | undefined>(undefined);

  return (
    <>
      {/**No accounts avaible */}
      {accounts.length === 0 && <NoAccountAvaible />}

      {accounts.length !== 0 && (
        <>
          <SidebarGroup className="flex-1  lg:w-3/6 space-y-6">
            {/* Account selection section */}
            <div>
              <div className="flex-grow space-y-4">
                {/* Search bar */}
                <div className="relative">
                  {!isSearchExpanded ? (
                    // Collapsed state - compact button
                    <div className="inline-block">
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

                      <div className="relative w-full transition-all duration-500 ease-out origin-top transform animate-in fade-in-0 slide-in-from-top-2">
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
              <VideoUpload
                onFileChange={handleFileChange}
                onDrop={handleDrop}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                isDragging={isDragging}
                fileInputRef={fileInputRef}
                // Pass the parent's ref
              />
            )}

            {/*image content*/}
            {postType === "image" && !selectedFile && (
              <ImageUpload
                onFileChange={handleFileChange}
                onDrop={handleDrop}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                isDragging={isDragging}
                fileInputRef={fileInputRef} // Pass the parent's ref
              />
            )}

            {/* caption field */}

            <Label htmlFor="text-content">
              {postType === "text" ? "Content" : "Caption"}
            </Label>
            <Textarea
              id="text-content"
              value={textInputs.description}
              onChange={(e) =>
                setTextInputs({
                  ...textInputs,
                  description: e.target.value,
                })
              }
              placeholder={
                postType === "text"
                  ? "Write your post content here"
                  : "Write a caption for your post"
              }
              rows={6}
              required
            />

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
                          <TabsTrigger value="captions">
                            Custom Captions
                          </TabsTrigger>
                        )}
                        {selectedPinterestAccount.length > 0 && (
                          <TabsTrigger value="pinterest">
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
                                      <span>
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

                                  <Textarea
                                    value={accountData?.description || ""}
                                    onChange={(e) => {
                                      if (isEditing) {
                                        setAccountContent((prev) =>
                                          prev.map((item) =>
                                            item.accountId === account.id
                                              ? {
                                                  ...item,
                                                  description: e.target.value,
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
                                    className={!isEditing ? "bg-muted/50" : ""}
                                  />
                                </div>
                              );
                            })}
                        </div>
                      </TabsContent>

                      {/* Pinterest Settings Tab */}
                      {selectedPinterestAccount.length > 0 && (
                        <TabsContent value="pinterest" className="mt-4">
                          <div className="space-y-4">
                            {/* Board selection for each Pinterest account */}
                            {selectedPinterestAccount.map((account) => (
                              <div
                                key={`pinterest-${account.id}`}
                                className="space-y-3 border rounded p-3"
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
                                  boards.filter(
                                    (board) => board.accountId === account.id
                                  ).length === 0 && (
                                    <div className="p-2 border rounded-md text-gray-500">
                                      No boards available for this account
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
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select a board" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {boards
                                          .filter(
                                            (board) =>
                                              board.accountId === account.id
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
                            <div className="space-y-2 mb-4">
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
                                placeholder="Add a title for all Pinterest pins"
                              />
                            </div>
                            {/* Single link field for all Pinterest accounts */}
                            <div className="space-y-2">
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
                              />
                            </div>
                          </div>
                        </TabsContent>
                      )}
                    </Tabs>
                  </>

                  /* Single account view - simplified when only one account is selected */
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
            <div className=" p-2.5 border rounded-2xl">
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
                  <div className="grid grid-cols-2 gap-3">
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
                    onClick={() =>
                      isScheduled
                        ? handleSchedueleSubmit()
                        : handleDirectPostSubmit()
                    }
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
