// components/uploads/VideoUpload.tsx
"use client";
import { RefObject } from "react";
import { UploadCloud } from "lucide-react";
import {
  ALLOWED_VIDEO_TYPES,
  MAX_VIDEO_SIZE_MB,
} from "@/components/core/create/constants/constants";

interface VideoUploadProps {
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  isDragging: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>; // Add this prop
}

export function VideoUpload({
  onFileChange,
  onDrop,
  onDragEnter,
  onDragLeave,
  onDragOver,
  isDragging,
  fileInputRef, // Receive the ref from parent
}: VideoUploadProps) {
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
      className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer   ${
        isDragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/30"
      }`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
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
          Videos (MP4, MOV) up to {MAX_VIDEO_SIZE_MB}MB
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_VIDEO_TYPES.join(",")}
        onChange={onFileChange}
        className="hidden"
      />
    </div>
  );
}
