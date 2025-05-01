"use client";

import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";
import AvatarWithFallback from "@/components/AvatarWithFallback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { SidebarGroup } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getPinterestBoards } from "@/lib/api/pinterest/data/getPinterestBoards";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";
import { format } from "date-fns";
import {
  AlertCircle,
  CalendarIcon,
  Clock,
  Loader2,
  Search,
  SendHorizontal,
  UploadCloud,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { generateState } from "../accounts/ConnectSocialAccounts/generateState";
import { directPostForLinkedInAccounts } from "./action/Direct/directPostForLinkedInAccounts";
import { directPostForPinterestAccounts } from "./action/Direct/directPostForPinterestAccounts";
import { scheduleForLinkedInAccounts } from "./action/Scheduled/scheduledForLinkedinAccounts";
import {
  scheduleForPinterestAccounts,
  ScheduleResult,
} from "./action/Scheduled/scheduleForPinterestAccounts";
import { scheduleForTikTokAccounts } from "./action/Scheduled/scheduleForTikTokAccounts";
import { uploadMedia } from "./action/uploadMedia";
import NoAccountAvaible from "./NoAccountAvaible";
import FilePreview from "./renderFilePreview";
import { StepProgress } from "./StepProgress";

// File upload constraints
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png"];
export const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/mov",
];
const MAX_IMAGE_SIZE_MB = 20;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const MAX_VIDEO_SIZE_MB = 50;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

// Platform icons and display names mapping
const platformConfig: Record<
  string,
  { icon: React.ReactNode; displayName: string }
> = {
  pinterest: {
    icon: <span className="text-red-600">📌</span>,
    displayName: "Pinterest",
  },
  tiktok: {
    icon: <span className="text-black">🎵</span>,
    displayName: "TikTok",
  },
  // Add other platforms as needed
  instagram: {
    icon: <span className="text-pink-500">📸</span>,
    displayName: "Instagram",
  },
  facebook: {
    icon: <span className="text-blue-600">👤</span>,
    displayName: "Facebook",
  },
};

interface SocialPostFormProps {
  readonly accounts: SocialAccount[];
  readonly userId: string | null;
}

type PlatformGroup = {
  platform: string;
  accounts: SocialAccount[];
  icon: React.ReactNode;
  displayName: string;
};

export default function SocialPostForm({
  accounts,
  userId,
}: SocialPostFormProps) {
  // Step tracking
  const [currentStep, setCurrentStep] = useState<number>(1);
  const steps = ["Content", "Accounts", "Details"];

  // Content step state
  const [activeTab, setActiveTab] = useState("media");
  const [isDragging, setIsDragging] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingBoards, setIsLoadingBoards] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video" | "text">(
    "video"
  );
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
      privacyLevel: "PUBLIC_TO_EVERYONE",
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
    setMediaType("video");
    setTextInputs({
      title: "",
      description: "",
      link: "",
    });
    setAccountContent([]);
    setSelectedAccounts({});
    setCurrentStep(1);

    // Missing resets
    setActiveTab("media");
    setIsDragging(false);
    setIsScheduled(false);
    setIsLoading(false);
    setIsLoadingBoards(false);
    setError(null);
    setPlatformOptions({
      tiktok: {
        privacyLevel: "PUBLIC_TO_EVERYONE",
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

  //========================================================================

  // Process accounts by platform with filtering
  const filteredPlatformGroups = Array.from(
    new Set(accounts.map((account) => account.platform))
  )
    .map((platform): PlatformGroup | null => {
      // Skip platforms that don't support text posts when in text mode
      if (
        activeTab === "text" &&
        (platform === "pinterest" ||
          platform === "tiktok" ||
          platform === "instagram")
      ) {
        return null;
      }

      // Filter accounts for current platform
      const platformAccounts = accounts.filter(
        (account) => account.platform === platform
      );

      // Apply search filter
      const filtered = searchQuery.trim()
        ? platformAccounts.filter((account) => {
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
          })
        : platformAccounts;

      // Only return platforms that have accounts after filtering
      if (filtered.length === 0) return null;

      const { icon, displayName } = platformConfig[platform] || {
        icon: null,
        displayName: platform.charAt(0).toUpperCase() + platform.slice(1),
      };

      return {
        platform,
        accounts: filtered,
        icon,
        displayName,
      };
    })
    .filter((group): group is PlatformGroup => group !== null);

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

  // Handle file selection for upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    setMediaType(isImage ? "image" : "video");
    setError(null);
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

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
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
    setMediaType(isImage ? "image" : "video");
    setError(null);
  };

  // Click upload button handler
  const handleClickUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Remove selected file
  const handleRemoveFile = () => {
    setSelectedFile(null);
    setMediaType("video");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Tab change handler
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setError(null); // Clear errors when switching tabs

    // Reset content when switching tabs
    setTextInputs({
      title: "",
      description: "",
      link: "",
    });

    // Set the appropriate media type based on tab
    if (value === "text") {
      setMediaType("text");

      // Clear the file if switching to text tab
      if (value === "text" && selectedFile) {
        handleRemoveFile();
      }

      // Clear selections for platforms that don't support text posts
      setSelectedAccounts((prev) => {
        const newSelections = { ...prev };
        accounts.forEach((account) => {
          if (
            account.platform === "pinterest" ||
            account.platform === "tiktok" ||
            account.platform === "instagram"
          ) {
            newSelections[account.id] = false;
          }
        });
        return newSelections;
      });
    } else if (selectedFile) {
      // Keep existing media type if there's a file already
      setMediaType(
        ALLOWED_IMAGE_TYPES.includes(selectedFile.type) ? "image" : "video"
      );
    } else {
      // Default for media tab with no selection
      setMediaType("video");
    }
  };

  // Account toggle handler
  const handleAccountToggle = (accountId: string) => {
    setSelectedAccounts((prev) => ({
      ...prev,
      [accountId]: !prev[accountId],
    }));
  };

  // Next step handler
  const handleNextStep = () => {
    if (currentStep === 1) {
      // Validate Content step
      if (activeTab === "media" && !selectedFile) {
        setError("Please upload a file before continuing.");
        return;
      }

      if (activeTab === "text" && !textInputs.description.trim()) {
        setError("Please enter a caption before continuing.");
        return;
      }
      setError(null);
    }

    if (currentStep === 2) {
      // Validate Accounts step
      const hasSelectedAccounts = Object.values(selectedAccounts).some(
        (selected) => selected
      );

      if (!hasSelectedAccounts) {
        toast.error("Please select at least one account.");
        return;
      }

      // Initialize account content for all selected accounts
      const selectedAccountsList = accounts.filter(
        (acc) => selectedAccounts[acc.id]
      );

      const initialContent = selectedAccountsList.map((account) => ({
        accountId: account.id,
        title: activeTab === "text" ? textInputs.title : "",
        description: activeTab === "text" ? textInputs.description : "",
        link: activeTab === "text" ? textInputs.link : "",
        isCustomized: false,
      }));

      setAccountContent(initialContent);
      loadPlatformSpecificData();
    }

    setCurrentStep((prev) => prev + 1);
  };

  // Previous step handler
  const handlePrevStep = () => {
    setCurrentStep((prev) => prev - 1);
    setError(null);
  };

  // Load platform-specific data based on selected accounts
  const loadPlatformSpecificData = () => {
    setIsLoadingBoards(true);
    const pinterestIds = accounts
      .filter(
        (acc) =>
          // First, check if it's a Pinterest account
          acc.platform === "pinterest" &&
          // Then check if it's selected in our selectedAccounts object
          selectedAccounts[acc.id] === true
      )
      .map((acc) => acc.id);

    pinterestIds.forEach(async (accountId) => {
      const account = accounts.find((acc) => acc.id === accountId);
      if (!account?.access_token) return;

      const fetchedBoards = await getPinterestBoards(account.access_token);

      const formatedBoards = fetchedBoards.map((board) => ({
        boardID: board.id, // Keep the original ID
        boardName: board.name, // Keep the board name
        accountId: accountId,
        isSelected: false,
      }));

      setBoards((prevBoards) => {
        // Filter out any existing boards for this account
        const otherAccountBoards = prevBoards.filter(
          (board) => board.accountId !== accountId
        );

        // Add the newly fetched boards
        return [...otherAccountBoards, ...formatedBoards];
      });
      setIsLoadingBoards(false);
    });
  };

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
    if (activeTab === "media") {
      if (!selectedFile) {
        setError("Please select a file to upload");
        return false;
      }
    }

    // Check if captions are provided (required for images only)
    if (mediaType === "text") {
      // Text post validation - we already have content from step 1
      const missingTitle = accountContent.some(
        (item) => !item.description.trim()
      );
      if (missingTitle) {
        setError("Please enter a caption");
        return false;
      }
    }

    if (
      isScheduled &&
      new Date(`${scheduledDate}T${scheduledTime}`) < new Date()
    ) {
      setError("The scheduled date cannot be in the past");
      return false;
    }

    // Pinterest-specific validation
    if (selectedPinterestAccount.length > 0 && activeTab === "media") {
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

    try {
      // 2. Téléchargement du média (si nécessaire)
      if (activeTab === "media" && selectedFile) {
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
        mediaType,
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
        mediaType,
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
        mediaType,
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
      if (mediaStoragePath && activeTab === "media") {
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
    let mediaPath = "";
    let batchId = "";
    try {
      batchId = generateState();

      // Upload media file if needed (only for media tab)
      if (activeTab === "media" && selectedFile) {
        const uploadResult = await uploadMedia(selectedFile, (progress) => {
          setUploadProgress(progress);
        });

        if (!uploadResult.success) {
          toast(uploadResult.message ?? "Failed to upload media");
        }

        mediaPath = uploadResult.path ?? "";
      }

      // Process Pinterest posts (only if we have media and accounts)
      if (activeTab === "media" && selectedFile) {
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
      }

      // Process LinkedIn posts (for both media and text tabs)
      if (selectedLinkedinAccount.length > 0) {
        // ───────────────── Linkedin ────────────────────
        linkedinResult = await directPostForLinkedInAccounts({
          accounts: selectedLinkedinAccount,
          mediaPath: activeTab === "media" && mediaPath ? mediaPath : "",
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

      // Calculate total successes
      const totalSuccessCount =
        (pinterestResult.success ? pinterestResult.count : 0) +
        (linkedinResult.success ? linkedinResult.count : 0);

      // Show success notification only if we had successful posts
      if (totalSuccessCount > 0) {
        const pinterestMsg =
          pinterestResult.success && pinterestResult.count > 0
            ? `${pinterestResult.count} post(s) on Pinterest`
            : "";

        const linkedinMsg =
          linkedinResult.success && linkedinResult.count > 0
            ? `${linkedinResult.count} post(s) on LinkedIn`
            : "";

        const separator = pinterestMsg && linkedinMsg ? " and " : "";

        toast.success(
          `${pinterestMsg}${separator}${linkedinMsg} published successfully!`
        );
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

  return (
    <SidebarGroup className="w-full max-w-3xl mx-auto">
      {/**No accounts avaible */}
      {accounts.length === 0 && <NoAccountAvaible />}

      {accounts.length !== 0 && (
        <>
          {/* Progress bar */}
          <StepProgress steps={steps} currentStep={currentStep} />

          {/* Step 1: Content */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <h1 className="text-2xl font-bold">Create a post</h1>

              <Tabs
                defaultValue="media"
                value={activeTab}
                onValueChange={handleTabChange}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="media">Media Post</TabsTrigger>
                  <TabsTrigger value="text">Text Post</TabsTrigger>
                </TabsList>

                {/*media content*/}
                <TabsContent value="media" className="space-y-4 mt-4 ">
                  {!selectedFile && (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="Upload file area"
                      className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
                        isDragging
                          ? "border-primary bg-primary/5"
                          : "border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/30"
                      }`}
                      onDragEnter={handleDragEnter}
                      onDragLeave={handleDragLeave}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onClick={handleClickUpload}
                      onKeyDown={(e) => {
                        // Trigger click on Enter or Space key
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleClickUpload();
                        }
                      }}
                    >
                      <div className="w-full h-full flex flex-col items-center justify-center">
                        <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="font-medium text-lg mb-2">
                          Click to upload or drag and drop
                        </h3>
                        <p className="text-sm text-muted-foreground mb-1">
                          or paste from clipboard
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Images (JPEG, PNG) up to {MAX_IMAGE_SIZE_MB}MB or
                          Videos (MP4, MOV) up to {MAX_VIDEO_SIZE_MB}MB
                        </p>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={[
                          ...ALLOWED_IMAGE_TYPES,
                          ...ALLOWED_VIDEO_TYPES,
                        ].join(",")}
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </div>
                  )}

                  {/**Remove file button */}
                  {selectedFile && (
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">Selected {mediaType}</h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleRemoveFile}
                        >
                          Remove
                        </Button>
                      </div>

                      {/**render file preview */}
                      <FilePreview
                        selectedFile={selectedFile}
                        mediaType={mediaType}
                        previewUrl={previewUrl}
                      />
                      <div className="text-sm text-muted-foreground mt-2">
                        {selectedFile.name} (
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/*text content*/}
                <TabsContent value="text" className="space-y-4 mt-4">
                  <div className="border rounded-lg p-4 space-y-3">
                    {/**Small alert */}
                    <Alert className="mb-4">
                      <AlertCircle className="h-4 w-4 mr-2" />
                      <AlertDescription>
                        Text posts are only supported on Facebook, Twitter,
                        Threads, Linkedin. Other platforms require media
                        content.
                      </AlertDescription>
                    </Alert>

                    {/**Caption */}
                    <div>
                      <Label htmlFor="text-content">Content</Label>
                      <Textarea
                        id="text-content"
                        value={textInputs.description}
                        onChange={(e) =>
                          setTextInputs({
                            ...textInputs,
                            description: e.target.value,
                          })
                        }
                        placeholder="Write your post content here"
                        rows={6}
                        required
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Button to go to the next step*/}
              <Button
                className="w-full"
                onClick={handleNextStep}
                disabled={
                  (activeTab === "media" && !selectedFile) ||
                  (activeTab === "text" && !textInputs.description.trim())
                }
              >
                Continue to Select Accounts
              </Button>
            </div>
          )}

          {/* Step 2: Account Selection */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <h1 className="text-2xl font-bold">Select Accounts</h1>

              <div className="flex gap-4">
                <div className="flex-grow space-y-4">
                  {/* Search bar */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                      placeholder="Search accounts..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  {/* Account grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredPlatformGroups.map(
                      ({
                        platform,
                        accounts: filteredAccounts,
                        icon,
                        displayName,
                      }) => (
                        <div
                          key={platform}
                          className="border rounded-lg overflow-hidden bg-card"
                        >
                          <div className="bg-muted p-3 flex items-center gap-2 font-medium">
                            {icon}
                            <span>{displayName}</span>
                          </div>

                          <div className="p-2 space-y-1">
                            {filteredAccounts.map((account: SocialAccount) => (
                              <div
                                key={account.id}
                                className="flex items-center gap-3 p-2 hover:bg-muted/50 rounded"
                              >
                                <Checkbox
                                  id={`account-${account.id}`}
                                  checked={!!selectedAccounts[account.id]}
                                  onCheckedChange={() =>
                                    handleAccountToggle(account.id)
                                  }
                                />

                                {/**Account Avatar  */}
                                <div className="w-6 h-6 rounded-full overflow-hidden">
                                  <AvatarWithFallback
                                    src={account.avatar_url}
                                    alt={account.username ?? "Account"}
                                    size={24}
                                    className="w-full h-full object-cover"
                                  />
                                </div>

                                {/**Account name */}
                                <span className="text-sm">
                                  {account.display_name ?? account.username}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>

                {/* Preview panel */}
                <div className="w-64 space-y-4 hidden lg:block">
                  {selectedFile && (
                    <>
                      <FilePreview
                        selectedFile={selectedFile}
                        mediaType={mediaType}
                        previewUrl={previewUrl}
                      />
                    </>
                  )}
                </div>
              </div>

              {/**Navigation Buttons*/}
              <div className="flex justify-between pt-4">
                {/**Back button */}
                <Button variant="outline" onClick={handlePrevStep}>
                  Back
                </Button>

                {/**Button to step 3 */}
                <Button
                  onClick={handleNextStep}
                  disabled={
                    !Object.values(selectedAccounts).some(
                      (selected) => selected
                    )
                  }
                >
                  Continue to Details
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Final Details & Scheduling */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <h1 className="text-2xl font-bold">Post Details</h1>

              <div className="border rounded-lg p-4 space-y-4">
                {/* Caption customization UI for media posts */}
                {activeTab === "media" && (
                  <div className="border rounded-lg p-4 space-y-4 mb-4">
                    <h3 className="font-medium">Post Caption</h3>

                    {/* Global caption - always shown for media posts */}
                    <div className="space-y-2">
                      {/* Add global Pinterest title field when Pinterest accounts are selected */}
                      {selectedPinterestAccount.length > 0 && (
                        <div className="space-y-2 pb-2 border-b">
                          <Label htmlFor="global-pin-title">
                            {Object.values(selectedAccounts).filter(Boolean)
                              .length > 1
                              ? "Default Pinterest Title"
                              : "Pinterest Title"}
                          </Label>

                          <Input
                            id="global-pin-title"
                            value={
                              accountContent.find((item) => !item.isCustomized)
                                ?.title ?? ""
                            }
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setAccountContent((prev) =>
                                prev.map((item) =>
                                  item.isCustomized
                                    ? item
                                    : {
                                        ...item,
                                        title: newValue,
                                      }
                                )
                              );
                            }}
                            placeholder="Add a title for your Pinterest pin"
                          />
                        </div>
                      )}

                      <Label htmlFor="global-caption">
                        {Object.values(selectedAccounts).filter(Boolean)
                          .length > 1
                          ? "Default Caption"
                          : "Caption"}
                      </Label>
                      <Textarea
                        id="global-caption"
                        value={
                          accountContent.find((item) => !item.isCustomized)
                            ?.description ?? ""
                        }
                        onChange={(e) => {
                          const newValue = e.target.value;
                          setAccountContent((prev) =>
                            prev.map((item) =>
                              item.isCustomized
                                ? item
                                : {
                                    ...item,
                                    description: newValue,
                                  }
                            )
                          );
                        }}
                        placeholder="Write a caption for your post"
                        rows={3}
                      />

                      <Label htmlFor="global-link">
                        {Object.values(selectedAccounts).filter(Boolean)
                          .length > 1
                          ? "Default Link (Optional)"
                          : "Link (Optional)"}
                      </Label>
                      <Input
                        id="global-link"
                        type="url"
                        value={
                          accountContent.find((item) => !item.isCustomized)
                            ?.link ?? ""
                        }
                        onChange={(e) => {
                          const newValue = e.target.value;
                          setAccountContent((prev) =>
                            prev.map((item) =>
                              item.isCustomized
                                ? item
                                : {
                                    ...item,
                                    link: newValue,
                                  }
                            )
                          );
                        }}
                        placeholder="https://example.com"
                      />
                    </div>

                    {/* Custom captions section - only shown if multiple accounts are selected */}
                    {Object.values(selectedAccounts).filter(Boolean).length >
                      1 && (
                      <div className="pt-2">
                        <h4 className="text-sm font-medium mb-2">
                          Custom Captions by Account
                        </h4>

                        {accounts
                          .filter(
                            (account) =>
                              selectedAccounts[account.id] &&
                              accountContent.some(
                                (item) => item.accountId === account.id
                              )
                          )
                          .map((account) => (
                            <div
                              key={account.id}
                              className="border rounded p-3 mb-3"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <AvatarWithFallback
                                    src={account.avatar_url}
                                    alt={account.username ?? "Account"}
                                    size={24}
                                  />
                                  <span>
                                    {account.display_name ?? account.username}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2">
                                  <Switch
                                    id={`custom-caption-${account.id}`}
                                    checked={
                                      accountContent.find(
                                        (item) => item.accountId === account.id
                                      )?.isCustomized || false
                                    }
                                    onCheckedChange={(checked) => {
                                      setAccountContent((prev) =>
                                        prev.map((item) =>
                                          item.accountId === account.id
                                            ? {
                                                ...item,
                                                isCustomized: checked,
                                              }
                                            : item
                                        )
                                      );
                                    }}
                                  />
                                  <Label
                                    htmlFor={`custom-caption-${account.id}`}
                                    className="text-xs"
                                  >
                                    Custom Caption
                                  </Label>
                                </div>
                              </div>

                              {accountContent.find(
                                (item) => item.accountId === account.id
                              )?.isCustomized ? (
                                <div className="space-y-2 pt-2">
                                  {/* Add Pinterest title field for Pinterest accounts only */}
                                  {account.platform === "pinterest" && (
                                    <div className="mb-2">
                                      <Input
                                        value={
                                          accountContent.find(
                                            (item) =>
                                              item.accountId === account.id
                                          )?.title ?? ""
                                        }
                                        onChange={(e) => {
                                          setAccountContent((prev) =>
                                            prev.map((item) =>
                                              item.accountId === account.id
                                                ? {
                                                    ...item,
                                                    title: e.target.value,
                                                  }
                                                : item
                                            )
                                          );
                                        }}
                                        placeholder="Custom Pinterest title"
                                      />
                                    </div>
                                  )}
                                  <Textarea
                                    value={
                                      accountContent.find(
                                        (item) => item.accountId === account.id
                                      )?.description ?? ""
                                    }
                                    onChange={(e) => {
                                      setAccountContent((prev) =>
                                        prev.map((item) =>
                                          item.accountId === account.id
                                            ? {
                                                ...item,
                                                description: e.target.value,
                                              }
                                            : item
                                        )
                                      );
                                    }}
                                    placeholder="Custom caption for this account"
                                    rows={2}
                                  />

                                  <Input
                                    type="url"
                                    value={
                                      accountContent.find(
                                        (item) => item.accountId === account.id
                                      )?.link ?? ""
                                    }
                                    onChange={(e) => {
                                      setAccountContent((prev) =>
                                        prev.map((item) =>
                                          item.accountId === account.id
                                            ? {
                                                ...item,
                                                link: e.target.value,
                                              }
                                            : item
                                        )
                                      );
                                    }}
                                    placeholder="Custom link (optional)"
                                  />
                                </div>
                              ) : (
                                <div className="text-sm text-muted-foreground italic">
                                  Using default caption
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Text post preview - only shown for text posts */}
                {activeTab === "text" && (
                  <div className="border rounded-lg p-4 space-y-4 mb-4">
                    <h3 className="font-medium">Text Post Preview</h3>
                    <div className="space-y-3">
                      {textInputs.title && (
                        <div>
                          <h4 className="text-sm font-medium mb-1">Title</h4>
                          <p className="p-2 bg-muted/30 rounded-md">
                            {textInputs.title}
                          </p>
                        </div>
                      )}

                      <div>
                        <h4 className="text-sm font-medium mb-1">Content</h4>
                        <p className="p-2 bg-muted/30 rounded-md whitespace-pre-wrap">
                          {textInputs.description}
                        </p>
                      </div>

                      {textInputs.link && (
                        <div>
                          <h4 className="text-sm font-medium mb-1">Link</h4>
                          <p className="p-2 bg-muted/30 rounded-md text-blue-600 underline">
                            {textInputs.link}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Pinterest-specific options */}
                {selectedPinterestAccount.map((account) => (
                  <div key={account.id} className="space-y-3 border-b pb-4">
                    <h3 className="font-medium">
                      Pinterest Options for{" "}
                      {account.display_name ?? account.username}
                    </h3>
                    <div className="space-y-2">
                      <Label htmlFor={`pinterest-board-${account.id}`}>
                        Pinterest Board
                      </Label>

                      {isLoadingBoards && (
                        <div className="p-2 border rounded-md text-gray-500">
                          Loading boards...
                        </div>
                      )}

                      {!isLoadingBoards &&
                        boards.filter((board) => board.accountId === account.id)
                          .length === 0 && (
                          <div className="p-2 border rounded-md text-gray-500">
                            No boards available for this account
                          </div>
                        )}

                      {/**The dropdown menu */}
                      {!isLoadingBoards &&
                        boards.filter((board) => board.accountId === account.id)
                          .length > 0 && (
                          <Select
                            value={
                              boards.find(
                                (b) =>
                                  b.accountId === account.id && b.isSelected
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
                            disabled={isLoadingBoards}
                          >
                            <SelectTrigger id={`pinterest-board-${account.id}`}>
                              <SelectValue placeholder="Select a board" />
                            </SelectTrigger>
                            <SelectContent>
                              {boards
                                .filter(
                                  (board) => board.accountId === account.id
                                )
                                .map((board) => (
                                  <SelectItem
                                    key={board.boardID}
                                    value={board.boardID}
                                  >
                                    {board.boardName}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        )}
                    </div>
                  </div>
                ))}

                {/* Scheduling toggle */}
                <div className="flex items-center space-x-2 py-2">
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
                      variant="outline"
                      onClick={handlePrevStep}
                      disabled={isLoading}
                    >
                      Back
                    </Button>

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
            </div>
          )}
        </>
      )}
    </SidebarGroup>
  );
}
