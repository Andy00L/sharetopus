"use client";

import { uploadWithSignedUrl } from "@/actions/client/signedUrlUpload";
import { deleteSupabaseFileAction } from "@/actions/server/data/storageFiles/deleteSupabaseFileAction";
import { Label } from "@/components/ui/label";
import { SidebarGroup } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SocialAccount, TikTokOptions } from "@/lib/types/dbTypes";
import { generateBatchId } from "@/lib/utils/generateBatchId";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { handleSocialMediaPost } from "../../../../actions/server/handleSocialMediaPost/handleSocialMediaPost";
import { CAPTION_LIMITS } from "../constants/captionLimits";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
} from "../constants/constants";
import NoAccountAvailable from "../NoAccountAvailable";
import { ImageUploads } from "../upload/ImageUpload";
import { VideoCoverSelector } from "../upload/VideoCoverSelector";
import { VideoUploads } from "../upload/VideoUpload";
import { useAccountContent } from "./hooks/useAccountContent";
import { usePinterestBoards } from "./hooks/usePinterestBoards";
import { useTikTokCreatorInfo } from "./hooks/useTikTokCreatorInfo";
import { convertPngToJpeg } from "./media/convertPngToJpeg";
import { pollDirectPostStatus } from "./polling/pollDirectPostStatus";
import AccountSelector from "./sections/AccountSelector";
import CaptionsTab from "./sections/CaptionsTab";
import PinterestSettingsTab from "./sections/PinterestSettingsTab";
import SchedulingPanel from "./sections/SchedulingPanel";
import TikTokSettingsTab from "./sections/TikTokSettingsTab";
import {
  DEFAULT_SCHEDULED_TIME,
  TIKTOK_COMPLIANCE_UI_ENABLED,
  defaultPlatformOptions,
  defaultTextInputs,
  getDefaultScheduledDate,
} from "./state/defaults";
import { checkFormSubmission } from "./validation/checkFormSubmission";

interface SocialPostFormProps {
  readonly accounts: SocialAccount[];
  readonly userId: string | null;
  readonly postType: "text" | "image" | "video";
  readonly uploadLimits?: { image: number; video: number };
}

export default function SocialPostForm({
  accounts,
  userId,
  postType,
  uploadLimits,
}: SocialPostFormProps) {
  const MAX_IMAGE_SIZE_BYTES = (uploadLimits?.image ?? 8) * 1024 * 1024;
  const MAX_VIDEO_SIZE_BYTES = (uploadLimits?.video ?? 8) * 1024 * 1024;

  // Core state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [coverTimestamp, setCoverTimestamp] = useState<number>(0);
  const [selectedAccounts, setSelectedAccounts] = useState<
    Record<string, boolean>
  >({});
  const [textInputs, setTextInputs] = useState({ ...defaultTextInputs });
  const [platformOptions, setPlatformOptions] = useState(() => ({
    ...defaultPlatformOptions,
  }));
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(getDefaultScheduledDate);
  const [scheduledTime, setScheduledTime] = useState<string>(
    DEFAULT_SCHEDULED_TIME,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [editingAccounts, setEditingAccounts] = useState<
    Record<string, boolean>
  >({});
  const [openTab, setOpenTab] = useState<string | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Hooks (event-driven, no useEffect)
  const {
    accountContent,
    addAccountContent,
    removeAccountContent,
    updateDefaultText,
    setCustomCaption,
    clearCustomization,
    resetContent,
  } = useAccountContent();

  const pinterestHook = usePinterestBoards(userId);

  // Derived data
  const selectedPinterestAccounts = accounts.filter(
    (acc) => selectedAccounts[acc.id] === true && acc.platform === "pinterest",
  );
  const selectedLinkedinAccounts = accounts.filter(
    (acc) => selectedAccounts[acc.id] === true && acc.platform === "linkedin",
  );
  const selectedTikTokAccounts = accounts.filter(
    (acc) => selectedAccounts[acc.id] === true && acc.platform === "tiktok",
  );
  const selectedInstagramAccounts = accounts.filter(
    (acc) => selectedAccounts[acc.id] === true && acc.platform === "instagram",
  );

  const tikTokCreatorHook = useTikTokCreatorInfo(
    selectedTikTokAccounts,
    TIKTOK_COMPLIANCE_UI_ENABLED,
  );

  // Legitimate useEffect: object URL lifecycle for preview
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

  // Event handlers
  function handleAccountToggle(accountId: string) {
    const wasSelected = selectedAccounts[accountId];
    setSelectedAccounts((prev) => ({
      ...prev,
      [accountId]: !prev[accountId],
    }));

    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;

    if (!wasSelected) {
      // Toggled ON
      addAccountContent(
        account,
        textInputs,
        platformOptions.pinterest?.link || "",
      );
      if (account.platform === "pinterest") {
        pinterestHook.loadBoardsForAccount(account);
      }
    } else {
      // Toggled OFF
      removeAccountContent(accountId);
      if (account.platform === "pinterest") {
        pinterestHook.unloadBoardsForAccount(accountId);
      }
    }
  }

  function handleTextInputChange(
    field: "title" | "description" | "link",
    value: string,
  ) {
    const clampedValue =
      field === "description" ? value.slice(0, CAPTION_LIMITS.default) : value;
    const newInputs = { ...textInputs, [field]: clampedValue };
    setTextInputs(newInputs);
    updateDefaultText(
      newInputs,
      platformOptions.pinterest?.link || "",
      selectedPinterestAccounts.map((a) => a.id),
    );
  }

  function handlePinterestTitleChange(title: string) {
    const newInputs = { ...textInputs, title };
    setTextInputs(newInputs);
    updateDefaultText(
      newInputs,
      platformOptions.pinterest?.link || "",
      selectedPinterestAccounts.map((a) => a.id),
    );
  }

  function handlePinterestLinkChange(link: string) {
    setPlatformOptions((prev) => ({
      ...prev,
      pinterest: { ...prev.pinterest!, link },
    }));
    updateDefaultText(
      textInputs,
      link,
      selectedPinterestAccounts.map((a) => a.id),
    );
  }

  function handleTikTokOptionsChange(update: Partial<TikTokOptions>) {
    setPlatformOptions((prev) => ({
      ...prev,
      tiktok: { ...prev.tiktok, ...update },
    }));
  }

  function resetForm() {
    setSelectedFile(null);
    setCoverTimestamp(0);
    setSelectedAccounts({});
    setTextInputs({ ...defaultTextInputs });
    setPlatformOptions({ ...defaultPlatformOptions });
    setIsScheduled(false);
    setScheduledDate(getDefaultScheduledDate());
    setScheduledTime(DEFAULT_SCHEDULED_TIME);
    setError(null);
    setIsLoading(false);
    setUploadProgress(0);
    setEditingAccounts({});
    setOpenTab(undefined);
    resetContent();
    pinterestHook.resetBoards();
  }

  async function handleSubmit() {
    const cleanupMediaOnError = async (path: string) => {
      if (path && userId) {
        try {
          await deleteSupabaseFileAction(userId, path);
        } catch {
          // Cleanup failures should not disrupt the main flow
        }
      }
    };

    if (isLoading) return;

    const validationResult = checkFormSubmission({
      userId,
      selectedAccounts,
      postType,
      selectedFile,
      maxImageSizeBytes: MAX_IMAGE_SIZE_BYTES,
      maxVideoSizeBytes: MAX_VIDEO_SIZE_BYTES,
      uploadLimits,
      isScheduled,
      scheduledDate,
      scheduledTime,
      selectedPinterestAccounts,
      boards: pinterestHook.boards,
      tiktokComplianceEnabled: TIKTOK_COMPLIANCE_UI_ENABLED,
      selectedTikTokAccounts,
      tikTokOptions: platformOptions.tiktok,
    });

    if (!validationResult.valid) {
      setError(validationResult.message);
      toast.error(validationResult.message);
      return;
    }

    setIsLoading(true);
    setError(null);
    setUploadProgress(0);

    const batchId = generateBatchId();
    let mediaStoragePath = "";

    try {
      if ((postType === "video" || postType === "image") && selectedFile) {
        const maxSize =
          postType === "image" ? MAX_IMAGE_SIZE_BYTES : MAX_VIDEO_SIZE_BYTES;
        if (selectedFile.size > maxSize) {
          setError(
            `File exceeds maximum size limit of ${maxSize / (1024 * 1024)}MB.`,
          );
          setIsLoading(false);
          return;
        }

        const uploadResult = await uploadWithSignedUrl(
          selectedFile,
          isScheduled,
          {
            onProgress: (progress) => setUploadProgress(progress),
          },
        );

        if (!uploadResult.success) {
          toast.error(uploadResult.message || "Failed to upload media");
          setError(uploadResult.message || "Failed to upload media");
          setIsLoading(false);
          return;
        }

        mediaStoragePath = uploadResult.path ?? "";
      }

      if (accountContent.length === 0) {
        setError("No content found for selected accounts.");
        setIsLoading(false);
        await cleanupMediaOnError(mediaStoragePath);
        return;
      }

      const result = await handleSocialMediaPost({
        pinterestAccounts: selectedPinterestAccounts,
        linkedinAccounts: selectedLinkedinAccounts,
        tiktokAccounts: selectedTikTokAccounts,
        instagramAccounts: selectedInstagramAccounts,
        mediaPath: mediaStoragePath,
        coverTimestamp,
        fileName: selectedFile?.name,
        boards: pinterestHook.boards,
        platformOptions,
        accountContent,
        isScheduled,
        scheduledDate: isScheduled ? scheduledDate : undefined,
        scheduledTime: isScheduled ? scheduledTime : undefined,
        postType,
        userId,
        batchId,
        cleanupFiles: !isScheduled,
      });

      // Direct posts with event_ids: poll for completion
      if (result.success && result.event_ids && result.event_ids.length > 0) {
        await pollDirectPostStatus(result.event_ids);
        resetForm();
      } else if (result.success) {
        // Scheduled posts: immediate success
        toast.success(
          result.message ||
            `Successfully ${
              isScheduled ? "scheduled" : "published"
            } your content!`,
        );
        if (result.errors && result.errors.length > 0) {
          setTimeout(() => {
            toast.warning(
              `Note: ${result.errors?.length} account(s) had issues.  See details for more information.`,
            );
          }, 500);
        }
        resetForm();
      } else if (result.resetIn) {
        toast.error(
          `You've reached the posting limit. Please try again in ${result.resetIn} seconds.`,
        );
        if (!result.counts || result.counts.total === 0) {
          await cleanupMediaOnError(mediaStoragePath);
        }
      } else {
        setError(result.message);
        toast.error(result.message);
        if (result.errors && result.errors.length > 0) {
          if (!result.message) {
            const firstError = result.errors[0];
            const friendlyError = firstError.error.includes(":")
              ? firstError.error.split(":")[0].trim()
              : firstError.error;
            toast.error(
              `Problem with ${firstError.platform}: ${friendlyError}`,
            );
          }
        }
        if (!result.counts || result.counts.total === 0) {
          await cleanupMediaOnError(mediaStoragePath);
        }
      }
    } catch {
      setError("Something went wrong. Please try again later.");
      await cleanupMediaOnError(mediaStoragePath);
    } finally {
      setIsLoading(false);
    }
  }

  // Render
  if (accounts.length === 0) {
    return <NoAccountAvailable />;
  }

  const selectedCount = Object.values(selectedAccounts).filter(Boolean).length;

  return (
    <>
      <SidebarGroup className="flex-1   lg:w-4/6 space-y-6">
        <AccountSelector
          accounts={accounts}
          selectedAccounts={selectedAccounts}
          onToggle={handleAccountToggle}
          postType={postType}
        />

        {/* Video upload / cover */}
        {postType === "video" && !selectedFile && (
          <VideoUploads
            maxSizeMB={uploadLimits?.video ?? 50}
            onFileSelected={(file) => {
              if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
                setError("Please select a valid video (MP4, MOV) file.");
                return;
              }
              if (file.size > MAX_VIDEO_SIZE_BYTES) {
                setError(
                  `File size exceeds the maximum limit of ${uploadLimits?.video}MB.`,
                );
                return;
              }
              setSelectedFile(file);
              setError(null);
            }}
          />
        )}
        {postType === "video" && selectedFile && (
          <VideoCoverSelector
            videoFile={selectedFile}
            onCoverChange={setCoverTimestamp}
            onError={setError}
          />
        )}

        {/* Image upload */}
        {postType === "image" && !selectedFile && (
          <ImageUploads
            maxSizeMB={uploadLimits?.image ?? 8}
            onFileSelected={async (file) => {
              if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
                setError("Please select a valid image (JPEG, PNG) file.");
                return;
              }

              let finalFile = file;
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
                  `File size exceeds the maximum limit of ${uploadLimits?.image}MB.`,
                );
                return;
              }
              setSelectedFile(finalFile);
              setError(null);
            }}
          />
        )}

        {/* Caption field */}
        <Label htmlFor="text-content">
          {postType === "text" ? "Content" : "Caption"}
        </Label>
        <div>
          <Textarea
            id="text-content"
            value={textInputs.description}
            onChange={(e) =>
              handleTextInputChange("description", e.target.value)
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

        {/* Tabs (captions + pinterest/tiktok settings) */}
        {(postType === "video" || postType === "image") &&
          (selectedPinterestAccounts.length > 0 ||
            selectedCount > 1 ||
            (TIKTOK_COMPLIANCE_UI_ENABLED &&
              selectedTikTokAccounts.length > 0)) && (
            <Tabs
              value={openTab}
              onValueChange={(value) => {
                setOpenTab(openTab === value ? undefined : value);
              }}
              defaultValue={
                selectedPinterestAccounts.length === 1 && selectedCount === 1
                  ? "pinterest"
                  : undefined
              }
            >
              <TabsList>
                {!(
                  selectedPinterestAccounts.length === 1 && selectedCount === 1
                ) && (
                  <TabsTrigger value="captions" className=" cursor-pointer">
                    Custom Captions
                  </TabsTrigger>
                )}
                {selectedPinterestAccounts.length > 0 && (
                  <TabsTrigger value="pinterest" className=" cursor-pointer ">
                    Pinterest Settings
                  </TabsTrigger>
                )}
                {TIKTOK_COMPLIANCE_UI_ENABLED &&
                  selectedTikTokAccounts.length > 0 && (
                    <TabsTrigger value="tiktok" className="cursor-pointer">
                      TikTok Settings
                    </TabsTrigger>
                  )}
              </TabsList>

              <TabsContent value="captions" className="mt-4">
                <CaptionsTab
                  accounts={accounts}
                  selectedAccounts={selectedAccounts}
                  accountContent={accountContent}
                  editingAccounts={editingAccounts}
                  onSetCustomCaption={setCustomCaption}
                  onClearCustomization={clearCustomization}
                  onSetEditing={(accountId, editing) =>
                    setEditingAccounts((prev) => ({
                      ...prev,
                      [accountId]: editing,
                    }))
                  }
                />
              </TabsContent>

              {selectedPinterestAccounts.length > 0 && (
                <TabsContent value="pinterest" className="mt-4">
                  <PinterestSettingsTab
                    selectedPinterestAccounts={selectedPinterestAccounts}
                    boards={pinterestHook.boards}
                    isLoadingBoards={pinterestHook.isLoadingBoards}
                    newBoardName={pinterestHook.newBoardName}
                    setNewBoardName={pinterestHook.setNewBoardName}
                    isCreatingBoard={pinterestHook.isCreatingBoard}
                    onCreateBoard={(accountId) =>
                      pinterestHook.handleCreateBoard(accountId, accounts)
                    }
                    onSelectBoard={pinterestHook.selectBoard}
                    textInputs={textInputs}
                    onTitleChange={handlePinterestTitleChange}
                    platformOptions={platformOptions}
                    onLinkChange={handlePinterestLinkChange}
                  />
                </TabsContent>
              )}

              {TIKTOK_COMPLIANCE_UI_ENABLED &&
                selectedTikTokAccounts.length > 0 && (
                  <TabsContent value="tiktok" className="mt-4">
                    <TikTokSettingsTab
                      selectedTikTokAccounts={selectedTikTokAccounts}
                      creatorInfo={tikTokCreatorHook.creatorInfo}
                      isLoadingCreatorInfo={tikTokCreatorHook.isLoading}
                      creatorInfoErrors={tikTokCreatorHook.errors}
                      postType={postType}
                      tikTokOptions={platformOptions.tiktok ?? {}}
                      onOptionsChange={handleTikTokOptionsChange}
                    />
                  </TabsContent>
                )}
            </Tabs>
          )}
      </SidebarGroup>

      <SidebarGroup className="w-full  lg:w-2/6 space-y-6">
        <SchedulingPanel
          selectedFile={selectedFile}
          previewUrl={previewUrl}
          postType={postType}
          isScheduled={isScheduled}
          setIsScheduled={setIsScheduled}
          scheduledDate={scheduledDate}
          setScheduledDate={setScheduledDate}
          scheduledTime={scheduledTime}
          setScheduledTime={setScheduledTime}
          error={error}
          isLoading={isLoading}
          uploadProgress={uploadProgress}
          onSubmit={handleSubmit}
          disabled={selectedCount === 0}
          tiktokComplianceEnabled={TIKTOK_COMPLIANCE_UI_ENABLED}
          hasTikTokAccounts={selectedTikTokAccounts.length > 0}
          tikTokOptions={platformOptions.tiktok}
        />
      </SidebarGroup>
    </>
  );
}
