// src/components/create/CreateTikTokPostForm.tsx
"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress"; // Keep for potential Supabase progress
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SocialAccount } from "@/lib/types/socialAccount"; // Adjust path
import { ChangeEvent, FormEvent, useRef, useState } from "react";
// Added CalendarIcon
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner"; // Import toast for notifications

// Shadcn Popover
import {
  deleteSupabaseFileAction,
  schedulePost,
} from "@/actions/server/supabase/scheduleActions";
import { uploadFileToSupabase } from "@/actions/server/supabase/uploadFile";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TikTokPrivacyLevel } from "@/lib/types/TikTokPrivacyLevel ";
import { cn } from "@/lib/utils"; // For shadcn class merging
import {
  AlertCircle,
  CalendarIcon,
  CheckCircle,
  Loader2,
  UploadCloud,
} from "lucide-react";
import { format } from "util";

interface CreateTikTokPostFormProps {
  readonly connectedAccounts: SocialAccount[];
  readonly user: string | null;
}

// Updated Statuses for Scheduling Flow
type PostStatus =
  | "idle"
  | "validating"
  | "uploading_supabase"
  | "scheduling" // Renamed from publishing
  | "success"
  | "error";

// --- Constants for Validation ---
const MAX_VIDEO_SIZE_MB = 1000; // Example: 1GB limit for Supabase upload (adjust as needed)
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"]; // Common types

export default function CreateTikTokPostForm({
  connectedAccounts,
  user,
}: CreateTikTokPostFormProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [title, setTitle] = useState<string>("");
  const [privacyLevel, setPrivacyLevel] =
    useState<TikTokPrivacyLevel>("SELF_ONLY");
  const [disableComment, setDisableComment] = useState<boolean>(false);
  const [disableDuet, setDisableDuet] = useState<boolean>(false);
  const [disableStitch, setDisableStitch] = useState<boolean>(false);
  const [scheduledAt, setScheduledAt] = useState<Date | undefined>(undefined); // State for date picker

  const [status, setStatus] = useState<PostStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setError(null); // Clear previous errors
    const file = event.target.files?.[0];

    if (file) {
      // --- File Type Validation ---
      if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
        toast.error(
          `Type de fichier invalide. Types acceptés: ${ALLOWED_VIDEO_TYPES.map(
            (t) => t.split("/")[1]
          ).join(", ")}`
        );
        setVideoFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      // --- File Size Validation ---
      if (file.size > MAX_VIDEO_SIZE_BYTES) {
        toast.error(
          `Fichier trop volumineux. Taille max: ${MAX_VIDEO_SIZE_MB} MB.`
        );
        setVideoFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      // File is valid
      setVideoFile(file);
    } else {
      setVideoFile(null);
    }
  };

  const resetForm = () => {
    setSelectedAccountId("");
    setVideoFile(null);
    setTitle("");
    setPrivacyLevel("SELF_ONLY");
    setDisableComment(false);
    setDisableDuet(false);
    setDisableStitch(false);
    setScheduledAt(undefined); // Reset date
    setStatus("idle");
    setError(null);
    setUploadProgress(0);
    setStatusMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null); // Clear previous errors
    setStatus("validating");

    if (!user) {
      toast.error("Utilisateur non authentifié.");
      setStatus("error");
      setError("Utilisateur non authentifié. Veuillez vous reconnecter.");
      return;
    }
    if (!selectedAccountId) {
      toast.error("Veuillez sélectionner un compte TikTok.");
      setStatus("error");
      setError("Veuillez sélectionner un compte TikTok.");
      return;
    }
    if (!videoFile) {
      toast.error("Veuillez sélectionner un fichier vidéo.");
      setStatus("error");
      setError("Veuillez sélectionner un fichier vidéo.");
      return;
    }
    if (!scheduledAt) {
      toast.error("Veuillez sélectionner une date et heure de publication.");
      setStatus("error");
      setError("Veuillez sélectionner une date et heure de publication.");
      return;
    }
    // Optional: Check if scheduledAt is in the past
    if (scheduledAt < new Date()) {
      toast.error("La date de publication ne peut pas être dans le passé.");
      setStatus("error");
      setError("La date de publication ne peut pas être dans le passé.");
      return;
    }

    setStatus("uploading_supabase");
    setUploadProgress(0);
    setStatusMessage("Téléversement vers le stockage...");

    let supabaseFilePath = "";

    try {
      // 1. Upload to Supabase Storage
      supabaseFilePath = await uploadFileToSupabase(
        user,
        videoFile,
        "scheduled-videos" // Use your bucket name
        // Add progress callback here if implemented
      );
      console.log("File uploaded to Supabase:", supabaseFilePath);
      setStatusMessage("Téléversement terminé. Programmation...");
      setUploadProgress(100); // Mark as complete

      // 2. Schedule Post (Server Action)
      setStatus("scheduling");
      const postOptions = {
        privacyLevel: privacyLevel,
        disableComment: disableComment,
        disableDuet: disableDuet,
        disableStitch: disableStitch,
      };

      const scheduleData = {
        socialAccountId: selectedAccountId,
        platform: "tiktok", // Hardcode for this form
        scheduledAt: scheduledAt, // Pass the Date object or ISO string
        title: title || null, // Pass null if empty
        mediaType: "video" as const, // Hardcode for this form
        mediaStoragePath: supabaseFilePath,
        postOptions: postOptions,
      };
      console.log(
        "DEBUG: Data sent to schedulePost:",
        JSON.stringify(scheduleData)
      );

      const result = await schedulePost(scheduleData);

      if (result.success) {
        setStatus("success");
        setStatusMessage(result.message);
        toast.success("Publication programmée avec succès!");
        console.log("Schedule successful:", result);
        setTimeout(resetForm, 3000); // Reset after success
      } else {
        throw new Error(result.message); // Throw error to be caught below
      }
    } catch (err) {
      console.error("Scheduling process failed:", err);
      setStatus("error");
      const errorMessage =
        err instanceof Error ? err.message : "Une erreur est survenue.";
      setError(errorMessage);
      setStatusMessage("Échec de la programmation.");
      toast.error(`Échec: ${errorMessage}`);

      // Attempt to clean up Supabase file if upload succeeded but scheduling failed
      if (supabaseFilePath) {
        console.warn(
          "Scheduling failed, attempting to clean up Supabase file:",
          supabaseFilePath
        );
        try {
          await deleteSupabaseFileAction(supabaseFilePath);
          toast.info("Fichier temporaire nettoyé.");
        } catch (deleteError) {
          console.error(
            "Failed to delete Supabase file after scheduling error:",
            deleteError
          );
          toast.error("Échec du nettoyage du fichier temporaire.");
        }
      }
    }
  };

  const isLoading =
    status === "validating" ||
    status === "uploading_supabase" ||
    status === "scheduling";

  // --- Button/Status Logic ---
  let buttonIcon = <UploadCloud className="mr-2 h-4 w-4" />;
  let buttonText = "Programmer la publication"; // Changed text

  if (status === "validating") {
    buttonIcon = <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
    buttonText = "Validation...";
  } else if (status === "uploading_supabase") {
    buttonIcon = <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
    // Show progress if available, otherwise just "Uploading..."
    buttonText = `Téléversement S... (${uploadProgress}%)`; // Example with progress
  } else if (status === "scheduling") {
    buttonIcon = <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
    buttonText = "Programmation...";
  }

  let statusIcon = null;
  if (
    status === "validating" ||
    status === "uploading_supabase" ||
    status === "scheduling"
  ) {
    statusIcon = <Loader2 className="h-4 w-4 animate-spin" />;
  } else if (status === "success") {
    statusIcon = <CheckCircle className="h-4 w-4 text-green-500" />;
  }
  // --- End Button/Status Logic ---

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Account Selection */}
      <div>
        <Label htmlFor="tiktokAccount">Compte TikTok</Label>
        <Select
          value={selectedAccountId}
          onValueChange={setSelectedAccountId}
          disabled={isLoading}
          required
        >
          <SelectTrigger id="tiktokAccount">
            <SelectValue placeholder="Sélectionnez un compte..." />
          </SelectTrigger>
          <SelectContent>
            {connectedAccounts.length === 0 && (
              <SelectItem value="no-accounts" disabled>
                Aucun compte TikTok connecté
              </SelectItem>
            )}
            {connectedAccounts.map((acc) => (
              <SelectItem key={acc.id} value={acc.id}>
                <div className="flex items-center gap-2">
                  <span>
                    {acc.extra?.profile?.display_name ??
                      acc.extra?.profile?.username ??
                      `Compte ID: ${acc.account_identifier.substring(0, 8)}`}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* File Input */}
      <div>
        <Label htmlFor="videoFile">Fichier Vidéo</Label>
        <Input
          id="videoFile"
          type="file"
          accept={ALLOWED_VIDEO_TYPES.join(",")} // Use defined types
          onChange={handleFileChange}
          ref={fileInputRef}
          required
          disabled={isLoading}
          className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
        />
        {videoFile && (
          <p className="text-sm text-muted-foreground mt-1">
            Sélectionné: {videoFile.name} (
            {(videoFile.size / 1024 / 1024).toFixed(2)} MB)
          </p>
        )}
      </div>

      {/* Title */}
      <div>
        <Label htmlFor="title">Titre (Légende)</Label>
        <Textarea
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Décrivez votre vidéo..."
          maxLength={2200}
          disabled={isLoading}
          rows={3}
        />
        <p className="text-sm text-muted-foreground mt-1">
          {title.length} / 2200 caractères
        </p>
      </div>

      {/* --- Date/Time Picker --- */}
      <div>
        <Label htmlFor="scheduledAt">Date et Heure de Publication</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={"outline"}
              className={cn(
                "w-full justify-start text-left font-normal",
                !scheduledAt && "text-muted-foreground"
              )}
              disabled={isLoading}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {scheduledAt ? (
                format(scheduledAt, "PPP HH:mm")
              ) : (
                <span>Choisissez une date et heure</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={scheduledAt}
              onSelect={setScheduledAt}
              initialFocus
              // Optional: Add time selection capabilities if needed
              // You might need a combined date/time picker component for better UX
            />
            {/* Basic Time Input - Consider a dedicated library component */}
            <div className="p-2 border-t">
              <Label htmlFor="scheduleTime">Heure (HH:MM)</Label>
              <Input
                id="scheduleTime"
                type="time"
                defaultValue={scheduledAt ? format(scheduledAt, "HH:mm") : ""}
                onChange={(e) => {
                  const time = e.target.value;
                  if (scheduledAt && time) {
                    const [hours, minutes] = time.split(":").map(Number);
                    const newDate = new Date(scheduledAt);
                    newDate.setHours(hours, minutes, 0, 0); // Set hours/minutes, reset seconds/ms
                    setScheduledAt(newDate);
                  } else if (!scheduledAt && time) {
                    // If no date selected yet, create a new date with today's date and selected time
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
      {/* --- End Date/Time Picker --- */}

      {/* Privacy Level */}
      <div>
        <Label htmlFor="privacyLevel">Visibilité</Label>
        <Select
          value={privacyLevel}
          onValueChange={(value) =>
            setPrivacyLevel(value as TikTokPrivacyLevel)
          }
          disabled={isLoading}
        >
          <SelectTrigger id="privacyLevel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PUBLIC_TO_EVERYONE">Public</SelectItem>
            <SelectItem value="MUTUAL_FOLLOW_FRIENDS">Amis</SelectItem>
            <SelectItem value="SELF_ONLY">Privé (Moi uniquement)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Toggles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="disableComment">Désactiver les commentaires</Label>
          <Switch
            id="disableComment"
            checked={disableComment}
            onCheckedChange={setDisableComment}
            disabled={isLoading}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="disableDuet">Désactiver les duos</Label>
          <Switch
            id="disableDuet"
            checked={disableDuet}
            onCheckedChange={setDisableDuet}
            disabled={isLoading}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="disableStitch">Désactiver les collages</Label>
          <Switch
            id="disableStitch"
            checked={disableStitch}
            onCheckedChange={setDisableStitch}
            disabled={isLoading}
          />
        </div>
      </div>

      {/* Progress and Status */}
      {/* Show progress bar only during Supabase upload for now */}
      {status === "uploading_supabase" && (
        <div>
          <Label>{statusMessage}</Label>
          <Progress value={uploadProgress} className="w-full mt-1" />
        </div>
      )}
      {/* Display status message if not idle and not uploading */}
      {status !== "idle" &&
        status !== "uploading_supabase" &&
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
          <AlertTitle>Erreur</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={isLoading || !videoFile || !selectedAccountId || !scheduledAt} // Add scheduledAt check
      >
        {buttonIcon}
        {buttonText}
      </Button>
    </form>
  );
}
