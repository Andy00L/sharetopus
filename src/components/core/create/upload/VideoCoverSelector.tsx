"use client";
import { Slider } from "@/components/ui/slider";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

interface VideoCoverSelectorProps {
  readonly videoFile: File;
  readonly onCoverChange: (timestamp: number) => void;
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
  const [pendingTime, setPendingTime] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

      // Add validation for invalid duration
      if (!videoDuration || videoDuration === 0 || !isFinite(videoDuration)) {
        onError?.(
          "Unable to load video duration. Please try a different file."
        );
        return;
      }

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

    // Convert to base64 and create preview
    const frameData = canvas.toDataURL("image/jpeg", 1);

    // Small delay to ensure smooth transition
    setTimeout(() => {
      setCoverPreview(frameData);
      onCoverChange(time * 1000);
    }, 50);
  };

  const handleSliderChange = (values: number[]) => {
    const newTime = values[0];
    setCurrentTime(newTime);
    setPendingTime(newTime);
  };
  // Add debounced thumbnail generation
  useEffect(() => {
    if (pendingTime === null) return;

    const timer = setTimeout(() => {
      generateThumbnail(pendingTime);
      setPendingTime(null);
    }, 150);

    return () => clearTimeout(timer);
  }, [pendingTime]);

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
          </div>
        )}
      </div>
      {/* Frame Selection Slider */}
      {duration > 0 && (
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
            <span className="font-medium text-primary">
              {currentTime.toFixed(1)}s
            </span>

            <span>{duration.toFixed(1)}s</span>
          </div>
        </div>
      )}
    </div>
  );
}
