// components/core/media/MediaPreview.tsx
"use client";

import { getSignedViewUrl } from "@/actions/client/getSignedViewUrl";
import { FileText, Image as ImageIcon, Video as VideoIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

interface MediaPreviewProps {
  readonly mediaPath?: string;
  readonly mediaType: string;
  readonly title?: string;
  readonly description?: string;
  readonly size?: "small" | "large";
  readonly userId: string;
  readonly onClick?: () => void;
}

export default function MediaPreview({
  mediaPath,
  mediaType,
  title,
  description,
  size = "small",
  userId,
  onClick,
}: MediaPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Get the signed URL when component mounts
  useEffect(() => {
    if (!mediaPath) {
      setIsLoading(false);
      return;
    }

    if (mediaType === "image") {
      setIsLoading(true);
      getSignedViewUrl(mediaPath, userId)
        .then((res) => {
          if (res.success && res.url) {
            setPreviewUrl(res.url);
          }
        })
        .catch((err) => console.error("Error fetching image URL:", err))
        .finally(() => setIsLoading(false));
    } else if (mediaType === "video") {
      setIsLoading(true);
      getSignedViewUrl(mediaPath, userId)
        .then(async (res) => {
          if (res.success && res.url) {
            try {
              const response = await fetch(res.url, {
                headers: {
                  Range: "bytes=0-10485760", // First 10MB
                },
              });

              if (response.ok || response.status === 206) {
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                setPreviewUrl(blobUrl);
              } else {
                console.error("Range request failed:", response.status);
                setPreviewUrl(null);
              }
            } catch (error) {
              console.error("Error with range request:", error);
              setPreviewUrl(null);
            }
          }
        })
        .catch((err) => console.error("Error fetching video URL:", err))
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [mediaPath, mediaType]);

  // If no media or it's text, show title/description
  if (!mediaPath || mediaType === "text") {
    return (
      <div className="w-full h-full flex flex-col items-start">
        <FileText className="h-6 w-6 text-green-500 mb-2" />
        <h3 className="font-medium text-sm mb-2">{title || "Post"}</h3>
        {description && (
          <p className="text-xs text-muted-foreground line-clamp-3">
            {description}
          </p>
        )}
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center">
        {mediaType === "image" ? (
          <ImageIcon className="h-6 w-6 text-blue-500 animate-pulse" />
        ) : (
          <VideoIcon className="h-6 w-6 text-red-500 animate-pulse" />
        )}
        <p className="text-sm mt-2">Loading preview...</p>
      </div>
    );
  }

  // Image preview
  if (mediaType === "image" && previewUrl) {
    return (
      <div
        className={`flex flex-col items-center cursor-pointer ${
          size === "large" ? "w-full max-h-96" : "w-full max-h-32"
        }`}
        onClick={onClick}
      >
        <div className="relative w-full h-full overflow-hidden rounded-md">
          <Image
            src={previewUrl}
            alt={title || "Image preview"}
            width={size === "large" ? 600 : 200}
            height={size === "large" ? 600 : 200}
            className="object-cover w-full h-full"
          />
        </div>
        {title && <p className="text-sm mt-2">{title}</p>}
      </div>
    );
  }

  // Video preview - large size
  if (mediaType === "video" && previewUrl) {
    return (
      <div className="flex flex-col items-center w-full max-h-96">
        <div className="relative w-full h-full overflow-hidden rounded-md bg-black">
          <video src={previewUrl} autoPlay loop muted />
        </div>
        {title && <p className="text-sm mt-2">{title}</p>}
      </div>
    );
  }

  // Fallback
  return (
    <div className="flex flex-col items-center">
      {mediaType === "image" ? (
        <ImageIcon className="h-6 w-6 text-blue-500" />
      ) : (
        <VideoIcon className="h-6 w-6 text-red-500" />
      )}
      <p className="text-sm mt-2">{title || "Media unavailable"}</p>
    </div>
  );
}
