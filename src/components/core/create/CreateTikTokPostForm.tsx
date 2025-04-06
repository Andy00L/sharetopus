// src/components/create/CreateTikTokPostForm.tsx
"use client";

import { useState, ChangeEvent, FormEvent, useRef } from "react";
// Removed useRouter as it's not currently used
// import { useRouter } from "next/navigation";
import { SocialAccount } from "@/lib/types/socialAccount"; // Adjusted path assumption
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
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Loader2, UploadCloud, CheckCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
// Import the server actions - Adjust path as needed
import {
  initiateTikTokVideoUpload,
  publishTikTokVideo,
} from "@/actions/server/social/tiktok/tiktokActions"; // Adjusted path assumption

// Define the allowed privacy level strings
type TikTokPrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "SELF_ONLY";

interface CreateTikTokPostFormProps {
  // Ensure SocialAccount type is correctly imported/defined
  readonly connectedAccounts: SocialAccount[];
}

type PostStatus =
  | "idle"
  | "initiating"
  | "uploading"
  | "publishing"
  | "success"
  | "error";

export default function CreateTikTokPostForm({
  connectedAccounts,
}: CreateTikTokPostFormProps) {
  // Removed router as it's not used
  // const router = useRouter();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [title, setTitle] = useState<string>("");
  const [privacyLevel, setPrivacyLevel] =
    useState<TikTokPrivacyLevel>("SELF_ONLY"); // Default to private
  const [disableComment, setDisableComment] = useState<boolean>(false);
  const [disableDuet, setDisableDuet] = useState<boolean>(false);
  const [disableStitch, setDisableStitch] = useState<boolean>(false);

  const [status, setStatus] = useState<PostStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("video/")) {
        setError("Veuillez sélectionner un fichier vidéo.");
        setVideoFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setError(null);
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
    setStatus("idle");
    setError(null);
    setUploadProgress(0);
    setStatusMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedAccountId || !videoFile) {
      setError("Veuillez sélectionner un compte et un fichier vidéo.");
      return;
    }

    setStatus("initiating");
    setError(null);
    setUploadProgress(0);
    setStatusMessage("Initialisation du téléversement...");

    let uploadUrl = "";
    let publishId = "";

    try {
      // 1. Initiate Upload
      const initData = await initiateTikTokVideoUpload(selectedAccountId);
      uploadUrl = initData.upload_url;
      publishId = initData.publish_id;
      console.log("Upload URL:", uploadUrl);
      console.log("Publish ID:", publishId);

      // 2. Upload Video File
      setStatus("uploading");
      setStatusMessage("Téléversement de la vidéo...");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader("Content-Type", "video/mp4"); // Adjust if needed

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(percentComplete);
            setStatusMessage(`Téléversement: ${percentComplete}%`);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            console.log("Video uploaded successfully to TikTok URL.");
            setUploadProgress(100);
            resolve();
          } else {
            console.error("Upload failed:", xhr.status, xhr.responseText);
            reject(
              new Error(
                `Échec du téléversement vers TikTok (${xhr.status}): ${
                  xhr.responseText || "Erreur inconnue"
                }`
              )
            );
          }
        };
        xhr.onerror = () => {
          console.error("Upload network error");
          reject(new Error("Erreur réseau lors du téléversement."));
        };
        xhr.send(videoFile);
      });

      // 3. Publish Video
      setStatus("publishing");
      setStatusMessage("Publication de la vidéo sur TikTok...");
      const publishData = await publishTikTokVideo(
        selectedAccountId,
        publishId,
        title || videoFile.name, // Use filename as fallback title
        privacyLevel, // Pass the correctly typed state variable
        disableComment,
        disableDuet,
        disableStitch
      );

      setStatus("success");
      setStatusMessage(
        `Vidéo publiée avec succès! Share ID: ${publishData.share_id}`
      );
      console.log("Publish successful:", publishData);

      setTimeout(() => {
        resetForm();
        // If navigation is needed later, uncomment and ensure router is imported/used
        // router.push('/posts');
      }, 3000);
    } catch (err) {
      console.error("Post creation failed:", err);
      setStatus("error");
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
      setStatusMessage("Échec de la publication.");
    }
  };

  const isLoading =
    status === "initiating" ||
    status === "uploading" ||
    status === "publishing";

  // --- Refactor Button Content Logic ---
  let buttonIcon = <UploadCloud className="mr-2 h-4 w-4" />;
  let buttonText = "Publier sur TikTok";

  if (status === "initiating") {
    buttonIcon = <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
    buttonText = "Initialisation...";
  } else if (status === "uploading") {
    buttonIcon = <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
    buttonText = `Téléversement (${uploadProgress}%)`;
  } else if (status === "publishing") {
    buttonIcon = <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
    buttonText = "Publication...";
  }
  // --- End Refactor ---

  // --- Refactor Status Icon Logic ---
  let statusIcon = null;
  if (status === "initiating" || status === "publishing") {
    statusIcon = <Loader2 className="h-4 w-4 animate-spin" />;
  } else if (status === "success") {
    statusIcon = <CheckCircle className="h-4 w-4 text-green-500" />;
  }
  // --- End Refactor ---

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
          accept="video/*"
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

      {/* Privacy Level */}
      <div>
        <Label htmlFor="privacyLevel">Visibilité</Label>
        <Select
          value={privacyLevel}
          // --- FIX: Cast incoming string value ---
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
      {status === "uploading" && (
        <div>
          <Label>{statusMessage}</Label>
          <Progress value={uploadProgress} className="w-full mt-1" />
        </div>
      )}
      {/* Display status message if not idle and not uploading */}
      {status !== "idle" && status !== "uploading" && statusMessage && (
        <div className="text-sm font-medium flex items-center gap-2">
          {/* Use the refactored statusIcon */}
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
        disabled={isLoading || !videoFile || !selectedAccountId}
      >
        {/* Use the refactored buttonIcon and buttonText */}
        {buttonIcon}
        {buttonText}
      </Button>
    </form>
  );
}
