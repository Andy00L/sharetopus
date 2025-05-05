// components/uploads/ImageUpload.tsx
"use client";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_MB,
} from "@/components/core/create/constants/constants";
import { UploadCloud } from "lucide-react";
import { RefObject } from "react";

interface ImageUploadProps {
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  isDragging: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>; // Add this prop
}

export function ImageUpload({
  onFileChange,
  onDrop,
  onDragEnter,
  onDragLeave,
  onDragOver,
  isDragging,
  fileInputRef, // Receive the ref from parent
}: ImageUploadProps) {
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
      aria-label="Upload image area"
      className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
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
        <h3 className="font-medium text-lg mb-2">Upload Image</h3>
        <p className="text-sm text-muted-foreground mb-1">
          Drag and drop your image here
        </p>
        <p className="text-sm text-muted-foreground mb-1">or click to browse</p>
        <p className="text-xs text-muted-foreground">
          Images (JPEG, PNG) up to {MAX_IMAGE_SIZE_MB}MB
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        onChange={onFileChange}
        className="hidden"
      />
    </div>
  );
}
