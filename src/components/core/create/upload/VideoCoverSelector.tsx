"use client";
import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Upload, RotateCcw } from "lucide-react";
import Image from "next/image";

interface VideoCoverSelectorProps {
  readonly videoFile: File;
  readonly onCoverChange: (coverFile: File) => void;
  readonly onError?: (errorMessage: string) => void;
}

export function VideoCoverSelector({
  videoFile,
  onCoverChange,
  onError,
}: VideoCoverSelectorProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [coverPreview, setCoverPreview] = useState<string>("");
  const [isCustomCover, setIsCustomCover] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (videoFile && videoRef.current) {
      const videoUrl = URL.createObjectURL(videoFile);
      videoRef.current.src = videoUrl;

      return () => URL.revokeObjectURL(videoUrl);
    }
  }, [videoFile]);

  const handleVideoLoaded = () => {
    if (videoRef.current) {
      const videoDuration = videoRef.current.duration;
      setDuration(videoDuration);

      // Set initial time to 10% of video duration
      const initialTime = videoDuration * 0.1;
      setCurrentTime(initialTime);
      videoRef.current.currentTime = initialTime;
    }
  };

  const generateThumbnail = async (time: number) => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    if (!context) return;

    video.currentTime = time;

    // Wait for seek to complete
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    // Set canvas size to video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current frame
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to blob and create preview
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const previewUrl = URL.createObjectURL(blob);
          setCoverPreview(previewUrl);

          // Create File for upload
          const coverFile = new File([blob], `${videoFile.name}-cover.png`, {
            type: "image/png",
          });

          onCoverChange(coverFile);
        }
      },
      "image/png",
      0.8
    );
  };

  const handleSliderChange = (values: number[]) => {
    const newTime = values[0];
    setCurrentTime(newTime);
    generateThumbnail(newTime);
    setIsCustomCover(false);
  };

  const handleCustomUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      // Only allow PNG and JPEG
      const allowedTypes = ["image/png", "image/jpeg", "image/jpg"];

      if (allowedTypes.includes(file.type)) {
        setIsCustomCover(true);
        const previewUrl = URL.createObjectURL(file);
        setCoverPreview(previewUrl);
        onCoverChange(file);
      } else {
        // Show error for unsupported format
        onError?.("Please select a PNG or JPEG image file for the cover.");
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    }
  };

  const resetToGenerated = () => {
    setIsCustomCover(false);
    generateThumbnail(currentTime);
  };

  // Generate initial thumbnail
  useEffect(() => {
    if (duration > 0) {
      generateThumbnail(currentTime);
    }
  }, [duration]);

  return (
    <div className="space-y-4 border-2 border-dashed border-chart-1 bg-white rounded-lg p-12 text-center transition-colors hover:border-chart-1/80 hover:bg-[#e6e6e1]">
      {" "}
      {/* Hidden video element for thumbnail generation */}
      <video
        ref={videoRef}
        className="hidden"
        preload="metadata"
        onLoadedMetadata={handleVideoLoaded}
      />
      {/* Hidden canvas for thumbnail generation */}
      <canvas ref={canvasRef} className="hidden" />
      {/* Cover Preview */}
      <div className="space-y-3">
        <h3 className="font-medium">Cover Image</h3>

        {coverPreview && (
          <div className="relative w-full max-w-sm mx-auto">
            <Image
              src={coverPreview}
              height={48}
              width={48}
              alt="Cover preview"
              className="w-full h-48 object-cover rounded-lg border"
            />
            {isCustomCover && (
              <div className="absolute top-2 right-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={resetToGenerated}
                  className="bg-black/50 text-white hover:bg-black/70"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {/* Frame Selection Slider */}
      {!isCustomCover && duration > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Frame for Cover</label>
          <Slider
            value={[currentTime]}
            onValueChange={handleSliderChange}
            max={duration}
            min={0}
            step={0.1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0s</span>
            <span>{duration.toFixed(1)}s</span>
          </div>
        </div>
      )}
      {/* Custom Upload Button */}
      <div className="flex justify-center">
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2"
        >
          <Upload className="h-4 w-4" />
          Upload Custom Cover
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          onChange={handleCustomUpload}
          className="hidden"
        />
      </div>
      {isCustomCover && (
        <p className="text-sm text-center text-muted-foreground">
          Using custom cover image (PNG/JPEG)
        </p>
      )}
    </div>
  );
}
