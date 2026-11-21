"use client";
import { Slider } from "@/components/ui/slider";
import { useObjectUrl } from "@/hooks/use-object-url";
import Image from "next/image";
import { useRef, useState } from "react";

interface VideoCoverSelectorProps {
  readonly videoFile: File;
  readonly onCoverChange: (timestamp: number) => void;
  readonly onError?: (errorMessage: string) => void;
  /** The video's length in seconds, once its metadata has loaded. */
  readonly onDurationLoaded?: (durationSec: number) => void;
}

const THUMBNAIL_DEBOUNCE_MS = 150;
const INITIAL_COVER_FRACTION = 0.1;
const COVER_PREVIEW_MAX_WIDTH_PX = 768;
const COVER_PREVIEW_JPEG_QUALITY = 0.85;

export function VideoCoverSelector({
  videoFile,
  onCoverChange,
  onError,
  onDurationLoaded,
}: VideoCoverSelectorProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [coverPreview, setCoverPreview] = useState<string>("");

  const videoUrl = useObjectUrl(videoFile);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const generateThumbnail = async (time: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!video || !canvas || !context) return;

    video.currentTime = time;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    const previewScale = Math.min(
      1,
      COVER_PREVIEW_MAX_WIDTH_PX / video.videoWidth
    );
    canvas.width = Math.round(video.videoWidth * previewScale);
    canvas.height = Math.round(video.videoHeight * previewScale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    setCoverPreview(
      canvas.toDataURL("image/jpeg", COVER_PREVIEW_JPEG_QUALITY)
    );
    onCoverChange(time * 1000);
  };

  const scheduleThumbnail = (time: number) => {
    clearTimeout(thumbnailTimerRef.current);
    thumbnailTimerRef.current = setTimeout(() => {
      void generateThumbnail(time);
    }, THUMBNAIL_DEBOUNCE_MS);
  };

  const handleVideoLoaded = () => {
    const videoDuration = videoRef.current?.duration;
    if (!videoDuration || !Number.isFinite(videoDuration)) {
      onError?.("Unable to load video duration. Please try a different file.");
      return;
    }

    setDuration(videoDuration);
    onDurationLoaded?.(videoDuration);

    const initialTime = videoDuration * INITIAL_COVER_FRACTION;
    setCurrentTime(initialTime);
    // No seek here: a seek to the time the video already shows fires no
    // `seeked` event, which would leave generateThumbnail waiting forever.
    scheduleThumbnail(initialTime);
  };

  const handleSliderChange = (values: number[]) => {
    const newTime = values[0];
    setCurrentTime(newTime);
    scheduleThumbnail(newTime);
  };

  return (
    <div className="space-y-4 border-2 border-dashed border-chart-1 bg-card rounded-lg p-12 text-center transition-colors hover:border-chart-1/80 hover:bg-accent">
      {" "}
      {/* Hidden video element for thumbnail generation */}
      <video
        ref={videoRef}
        src={videoUrl ?? undefined}
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
