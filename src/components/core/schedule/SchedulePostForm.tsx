// components/core/scheduled/SchedulePostForm.tsx
"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

import { Textarea } from "@/components/ui/textarea";
import { uploadWithSignedUrl } from "@/lib/client/signedUrlUpload";

import {
  AlertCircle,
  CalendarIcon,
  CheckCircle,
  Loader2,
  UploadCloud,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { deleteSupabaseFileAction } from "@/actions/server/scheduleActions/deleteSupabaseFileAction";
import { schedulePost } from "@/actions/server/scheduleActions/schedulePost";
import {
  Platform,
  PlatformOptions,
  PostStatus,
  SocialAccount,
} from "@/lib/types/dbTypes";
import { SchedulePostData } from "@/lib/types/SchedulePostData";
import { TikTokPostOptions } from "./platform-options/TikTokOptions";
import { PinterestPostOptions } from "./platform-options/PinterestOptions";
// Removed unused import

// Constants for media validation
const MAX_VIDEO_SIZE_MB = 1000; // 1GB max upload size
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"];

interface SchedulePostFormProps {
  readonly connectedAccounts: SocialAccount[];
  readonly userId: string | null;
}

export default function SchedulePostForm({
  connectedAccounts,
  userId,
}: SchedulePostFormProps) {
  const router = useRouter();

  // Core state
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | "">("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [availableAccounts, setAvailableAccounts] = useState<SocialAccount[]>(
    []
  );
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [caption, setCaption] = useState<string>("");
  const [scheduledAt, setScheduledAt] = useState<Date | undefined>(undefined);

  // Pinterest-specific state
  const [loadingBoards, setLoadingBoards] = useState(false);

  // Platform-specific options
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
  });

  // UI state
  const [status, setStatus] = useState<PostStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Update available accounts when platform changes
  const handlePlatformChange = (value: string) => {
    setSelectedPlatform(value as Platform);
    setSelectedAccountId(""); // Reset selected account

    // Filter accounts by the selected platform
    const filteredAccounts = connectedAccounts.filter(
      (account) => account.platform === value
    );
    setAvailableAccounts(filteredAccounts);
  };

  // Update loading state when account selected
  useEffect(() => {
    if (selectedPlatform === "pinterest" && selectedAccountId) {
      setLoadingBoards(true);
      // We'll rely on the PinterestPostOptions component to fetch boards
      // This just ensures the form shows loading state
      setTimeout(() => setLoadingBoards(false), 500);
    }
  }, [selectedPlatform, selectedAccountId]);

  // Handle file selection and validation
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = event.target.files?.[0];

    if (file) {
      const allowedTypes =
        selectedPlatform === "pinterest"
          ? ALLOWED_IMAGE_TYPES
          : ALLOWED_VIDEO_TYPES;

      // File type validation
      if (!allowedTypes.includes(file.type)) {
        toast.error(
          `Invalid file type. ${
            selectedPlatform === "pinterest"
              ? "Pinterest requires image files"
              : "Accepted video types: mp4, quicktime, webm"
          }`
        );
        setMediaFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      // File size validation
      if (file.size > MAX_VIDEO_SIZE_BYTES) {
        toast.error(`File too large. Maximum size: ${MAX_VIDEO_SIZE_MB} MB.`);
        setMediaFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      setMediaFile(file);
    } else {
      setMediaFile(null);
    }
  };

  // Handle form submission
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus("validating");

    // Basic validation
    if (!userId) {
      toast.error("User not authenticated.");
      setStatus("error");
      setError("User not authenticated. Please log in again.");
      return;
    }
    if (!selectedPlatform) {
      toast.error("Please select a platform.");
      setStatus("error");
      setError("Please select a platform.");
      return;
    }
    if (!selectedAccountId) {
      toast.error("Please select an account.");
      setStatus("error");
      setError("Please select an account.");
      return;
    }
    if (!mediaFile) {
      toast.error("Please select a media file.");
      setStatus("error");
      setError("Please select a media file.");
      return;
    }
    if (!scheduledAt) {
      toast.error("Please select a date and time for publication.");
      setStatus("error");
      setError("Please select a date and time for publication.");
      return;
    }
    if (scheduledAt < new Date()) {
      toast.error("The publication date cannot be in the past.");
      setStatus("error");
      setError("The publication date cannot be in the past.");
      return;
    }

    // Platform-specific validation
    if (selectedPlatform === "pinterest") {
      if (!platformOptions.pinterest?.board) {
        toast.error("Please select a Pinterest board.");
        setStatus("error");
        setError("Please select a Pinterest board for your post.");
        return;
      }
    }

    // Upload and schedule process
    let mediaStoragePath = "";

    try {
      // Step 1: Upload media to Supabase Storage
      setStatus("uploading_media");
      setUploadProgress(0);
      setStatusMessage("Uploading to storage...");

      // Use the signed URL upload function
      mediaStoragePath = await uploadWithSignedUrl(mediaFile, {
        onProgress: (progress) => {
          setUploadProgress(progress);
        },
        onSuccess: (path) => {
          console.log("File uploaded successfully:", path);
          setStatusMessage("Upload complete. Scheduling...");
          setUploadProgress(100);
        },
        onError: (error) => {
          console.error("Upload error:", error);
          throw error; // Re-throw to be caught by the outer catch block
        },
      });

      console.log("File uploaded to Supabase:", mediaStoragePath);
      setStatusMessage("Upload complete. Scheduling...");
      setUploadProgress(100);

      // Step 2: Schedule Post
      setStatus("scheduling");

      // Determine media type
      const mediaType = ALLOWED_IMAGE_TYPES.includes(mediaFile.type)
        ? "image"
        : "video";

      // Prepare platform-specific options based on selected platform
      let postOptions: SchedulePostData["postOptions"] = null;

      if (selectedPlatform === "tiktok" && platformOptions.tiktok) {
        postOptions = {
          privacyLevel: platformOptions.tiktok.privacyLevel,
          disableComment: platformOptions.tiktok.disableComment,
          disableDuet: platformOptions.tiktok.disableDuet,
          disableStitch: platformOptions.tiktok.disableStitch,
        };
      } else if (
        selectedPlatform === "pinterest" &&
        platformOptions.pinterest
      ) {
        postOptions = {
          privacyLevel: platformOptions.pinterest.privacyLevel,
          board: platformOptions.pinterest.board,
          link: platformOptions.pinterest.link || undefined,
        };
      }

      // Schedule data for the server action
      const scheduleData = {
        socialAccountId: selectedAccountId,
        platform: selectedPlatform,
        scheduledAt: scheduledAt,
        title: caption || null,
        mediaType: (mediaType as "video") || "image",
        mediaStoragePath: mediaStoragePath,
        postOptions: postOptions,
      };

      console.log("Scheduling data:", JSON.stringify(scheduleData));

      const result = await schedulePost(scheduleData, userId);

      if (result.success) {
        setStatus("success");
        setStatusMessage(result.message);
        toast.success("Post scheduled successfully!");
        console.log("Schedule successful:", result);

        // Reset form after successful scheduling
        setTimeout(() => {
          resetForm();
          // Optionally redirect to scheduled posts page
          router.push("/scheduled");
        }, 500);
      } else {
        throw new Error(result.message);
      }
    } catch (err) {
      console.error("Scheduling process failed:", err);
      setStatus("error");
      const errorMessage =
        err instanceof Error ? err.message : "An error occurred.";
      setError(errorMessage);
      setStatusMessage("Scheduling failed.");
      toast.error(`Failure: ${errorMessage}`);

      // Clean up Supabase file if upload succeeded but scheduling failed
      if (mediaStoragePath) {
        console.warn(
          "Scheduling failed, attempting to clean up Supabase file:",
          mediaStoragePath
        );
        try {
          await deleteSupabaseFileAction(mediaStoragePath, userId);
          toast.info("Temporary file cleaned up.");
        } catch (deleteError) {
          console.error(
            "Failed to delete Supabase file after scheduling error:",
            deleteError
          );
          toast.error("Failed to clean up temporary file.");
        }
      }
    }
  };

  // Update platform-specific options
  const updatePlatformOptions = <T extends keyof PlatformOptions>(
    platform: T,
    options: PlatformOptions[T]
  ) => {
    setPlatformOptions((prev) => ({
      ...prev,
      [platform]: options,
    }));
  };

  // Reset form state
  const resetForm = () => {
    setSelectedPlatform("");
    setSelectedAccountId("");
    setAvailableAccounts([]);
    setMediaFile(null);
    setCaption("");
    setScheduledAt(undefined);
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
    setStatus("idle");
    setError(null);
    setUploadProgress(0);
    setStatusMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // UI states
  const isLoading = ["validating", "uploading_media", "scheduling"].includes(
    status
  );

  // Button/status logic
  let buttonIcon = <UploadCloud className="mr-2 h-4 w-4" />;
  let buttonText = "Schedule Post";

  if (status === "validating") {
    buttonIcon = <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
    buttonText = "Validating...";
  } else if (status === "uploading_media") {
    buttonIcon = <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
    buttonText = `Uploading (${uploadProgress}%)`;
  } else if (status === "scheduling") {
    buttonIcon = <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
    buttonText = "Scheduling...";
  }

  let statusIcon = null;
  if (isLoading) {
    statusIcon = <Loader2 className="h-4 w-4 animate-spin" />;
  } else if (status === "success") {
    statusIcon = <CheckCircle className="h-4 w-4 text-green-500" />;
  }

  // Get allowed file types for the selected platform
  const getAllowedFileTypes = () => {
    if (selectedPlatform === "pinterest") {
      return ALLOWED_IMAGE_TYPES.join(",");
    }
    return ALLOWED_VIDEO_TYPES.join(",");
  };

  // Get file type description for the selected platform
  const getFileTypeDescription = () => {
    if (selectedPlatform === "pinterest") {
      return "Pinterest requires image files (JPEG, PNG, GIF)";
    }
    return "Accepted video types: MP4, QuickTime, WebM";
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Schedule a New Post</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Platform Selection */}
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <Select
              value={selectedPlatform}
              onValueChange={handlePlatformChange}
              disabled={isLoading}
              required
            >
              <SelectTrigger id="platform">
                <SelectValue placeholder="Select a platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tiktok">TikTok</SelectItem>
                <SelectItem value="pinterest">Pinterest</SelectItem>
                <SelectItem value="instagram" disabled>
                  Instagram (Coming Soon)
                </SelectItem>
                <SelectItem value="facebook" disabled>
                  Facebook (Coming Soon)
                </SelectItem>
                <SelectItem value="threads" disabled>
                  Threads (Coming Soon)
                </SelectItem>
                <SelectItem value="youtube" disabled>
                  YouTube (Coming Soon)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Account Selection - Show only if platform is selected */}
          {selectedPlatform && (
            <div className="space-y-2">
              <Label htmlFor="account">Account</Label>
              <Select
                value={selectedAccountId}
                onValueChange={setSelectedAccountId}
                disabled={isLoading || availableAccounts.length === 0}
                required
              >
                <SelectTrigger id="account">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {availableAccounts.length === 0 && (
                    <SelectItem value="no-accounts" disabled>
                      No {selectedPlatform} accounts connected
                    </SelectItem>
                  )}
                  {availableAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      <div className="flex items-center gap-2">
                        <span>
                          {acc.extra?.profile?.display_name ??
                            acc.extra?.profile?.username ??
                            `Account ID: ${acc.account_identifier.substring(
                              0,
                              8
                            )}`}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableAccounts.length === 0 && selectedPlatform && (
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => router.push("/accounts")}
                  >
                    Connect a {selectedPlatform} account
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Media Upload */}
          {selectedPlatform && (
            <div className="space-y-2">
              <Label htmlFor="mediaFile">
                {selectedPlatform === "pinterest" ? "Image File" : "Media File"}
              </Label>
              <Input
                id="mediaFile"
                type="file"
                accept={getAllowedFileTypes()}
                onChange={handleFileChange}
                ref={fileInputRef}
                required
                disabled={isLoading}
                className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
              <p className="text-xs text-muted-foreground">
                {getFileTypeDescription()}
              </p>
              {mediaFile && (
                <p className="text-sm text-muted-foreground mt-1">
                  Selected: {mediaFile.name} (
                  {(mediaFile.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              )}
            </div>
          )}

          {/* Caption/Text */}
          <div className="space-y-2">
            <Label htmlFor="caption">
              {selectedPlatform === "pinterest"
                ? "Title/Description"
                : "Caption"}
            </Label>
            <Textarea
              id="caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={
                selectedPlatform === "pinterest"
                  ? "Write a title and description for your pin..."
                  : "Write a caption for your post..."
              }
              maxLength={2200}
              disabled={isLoading}
              rows={3}
            />
            <p className="text-sm text-muted-foreground mt-1">
              {caption.length} / 2200 characters
            </p>
          </div>

          {/* Schedule Date/Time */}
          <div className="space-y-2">
            <Label htmlFor="scheduledAt">Scheduled Date and Time</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start text-left font-normal"
                  disabled={isLoading}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {scheduledAt ? (
                    new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(scheduledAt)
                  ) : (
                    <span>Select date and time</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={scheduledAt}
                  onSelect={setScheduledAt}
                  initialFocus
                />
                <div className="p-2 border-t">
                  <Label htmlFor="scheduleTime">Time (HH:MM)</Label>
                  <Input
                    id="scheduleTime"
                    type="time"
                    defaultValue={
                      scheduledAt ? scheduledAt.toTimeString().slice(0, 5) : ""
                    }
                    onChange={(e) => {
                      const time = e.target.value;
                      if (scheduledAt && time) {
                        const [hours, minutes] = time.split(":").map(Number);
                        const newDate = new Date(scheduledAt);
                        newDate.setHours(hours, minutes, 0, 0);
                        setScheduledAt(newDate);
                      } else if (!scheduledAt && time) {
                        const [hours, minutes] = time.split(":").map(Number);
                        const newDate = new Date();
                        newDate.setHours(hours, minutes, 0, 0);
                        setScheduledAt(newDate);
                      }
                    }}
                    disabled={isLoading}
                    className="mt-1"
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <Separator />

          {/* Platform-specific options */}
          {selectedPlatform === "tiktok" && selectedAccountId && (
            <TikTokPostOptions
              options={platformOptions.tiktok!}
              onChange={(options) => updatePlatformOptions("tiktok", options)}
              disabled={isLoading}
            />
          )}

          {selectedPlatform === "pinterest" && selectedAccountId && (
            <PinterestPostOptions
              options={platformOptions.pinterest!}
              onChange={(options) =>
                updatePlatformOptions("pinterest", options)
              }
              disabled={isLoading || loadingBoards}
              accountId={selectedAccountId}
              accounts={connectedAccounts}
            />
          )}

          {/* Progress and Status */}
          {status === "uploading_media" && (
            <div>
              <Label>{statusMessage}</Label>
              <Progress value={uploadProgress} className="w-full mt-1" />
            </div>
          )}

          {status !== "idle" &&
            status !== "uploading_media" &&
            statusMessage && (
              <div className="text-sm font-medium flex items-center gap-2">
                {statusIcon}
                <span>{statusMessage}</span>
              </div>
            )}

          {/* Error Display */}
          {error && status === "error" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={
          isLoading ||
          !selectedPlatform ||
          !selectedAccountId ||
          !mediaFile ||
          !scheduledAt ||
          (selectedPlatform === "pinterest" &&
            !platformOptions.pinterest?.board)
        }
        className="w-full"
      >
        {buttonIcon}
        {buttonText}
      </Button>
    </form>
  );
}
