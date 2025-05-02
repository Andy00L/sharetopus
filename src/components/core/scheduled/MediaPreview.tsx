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
  readonly onClick?: () => void;
}

export default function MediaPreview({
  mediaPath,
  mediaType,
  title,
  description,
  size = "small",
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
      getSignedViewUrl(mediaPath)
        .then((res) => {
          if (res.success && res.url) {
            setPreviewUrl(res.url);
          }
        })
        .catch((err) => console.error("Error fetching image URL:", err))
        .finally(() => setIsLoading(false));
    } else if (mediaType === "video") {
      setIsLoading(true);
      getSignedViewUrl(mediaPath)
        .then(async (res) => {
          if (res.success && res.url) {
            try {
              // This range is enough for a short preview (2-5 seconds) for most videos
              // 3MB is a reasonable compromise for preview quality
              const response = await fetch(res.url, {
                headers: {
                  Range: "bytes=0-3145728", // First 3MB
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
  }, [mediaPath, mediaType]);

  const handleVideoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

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

  // Video preview - small size
  if (mediaType === "video" && previewUrl && size === "small") {
    return (
      <div
        className="flex flex-col items-center w-full h-full cursor-pointer"
        onClick={onClick}
      >
        <div className="relative w-full h-full overflow-hidden rounded-md bg-black">
          <video
            src={previewUrl}
            className="w-full h-full object-cover"
            muted
            autoPlay
            loop
            playsInline
            onClick={handleVideoClick}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
            <VideoIcon className="h-8 w-8 text-white" />
          </div>
        </div>
        {title && <p className="text-sm mt-2">{title}</p>}
      </div>
    );
  }

  // Video preview - large size
  if (mediaType === "video" && previewUrl && size === "large") {
    return (
      <div className="flex flex-col items-center w-full max-h-96">
        <div className="relative w-full h-full overflow-hidden rounded-md bg-black">
          <video
            src={previewUrl}
            className="w-full h-full object-contain"
            controls
            autoPlay
            loop
            muted
            playsInline
            onClick={handleVideoClick}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 px-2 py-1 text-xs text-white text-center">
            Preview only - First few seconds of video
          </div>
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
