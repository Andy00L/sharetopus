// components/uploads/VideoUpload.tsx
"use client";
import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { ALLOWED_VIDEO_TYPES } from "@/components/core/create/constants/constants";

interface VideoUploadProps {
  readonly onFileSelected: (file: File) => void;
  readonly maxSizeMB: number;
}

export function VideoUploads({ onFileSelected, maxSizeMB }: VideoUploadProps) {
  // Local state management
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file); // Notify parent
    }
  };

  // Drag event handlers
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Increment counter when entering
    dragCounter.current += 1;

    // Only update visual state on first entry
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Decrement counter when leaving
    dragCounter.current -= 1;

    // Only update visual state when fully leaving the component
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Reset counter and visual state on drop
    dragCounter.current = 0;
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  // Handle click on the upload area
  const handleClickUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Handle keyboard interaction for accessibility
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClickUpload();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload video area"
      className={`border-2 border-dashed bg-white rounded-lg p-12 text-center transition-colors cursor-pointer ${
        isDragging
          ? "border-primary "
          : "border-muted-foreground/20 hover:border-primary/50 hover:bg-[#e6e6e1]"
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClickUpload}
      onKeyDown={handleKeyDown}
    >
      <div className="w-full h-full flex flex-col items-center justify-center">
        <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium text-lg mb-2">Upload Video</h3>
        <p className="text-sm text-muted-foreground mb-1">
          Drag and drop your video here
        </p>
        <p className="text-sm text-muted-foreground mb-1">or click to browse</p>
        <p className="text-xs text-muted-foreground">
          Videos (MP4, MOV) up to {maxSizeMB}MB
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_VIDEO_TYPES.join(",")}
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
