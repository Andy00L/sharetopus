// components/uploads/ImageUpload.tsx
"use client";
import { useState, useRef } from "react";
import { ALLOWED_IMAGE_TYPES } from "@/components/core/create/constants/constants";
import { UploadCloud } from "lucide-react";

interface ImageUploadProps {
  readonly onFileSelected: (file: File) => void;
  readonly maxSizeMB: number;
}

export function ImageUploads({ onFileSelected, maxSizeMB }: ImageUploadProps) {
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

    // Increment the counter when entering
    dragCounter.current += 1;

    // Only set isDragging to true when first entering
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Decrement the counter when leaving
    dragCounter.current -= 1;

    // Only set isDragging to false when completely leaving the component
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Reset counter and dragging state
    dragCounter.current = 0;
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
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
      aria-label="Upload image area"
      className={`border-2 border-dashed bg-white rounded-lg p-12 text-center transition-colors cursor-pointer ${
        isDragging
          ? "border-primary bg-primary/5 "
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
        <h3 className="font-medium text-lg mb-2">Upload Image</h3>
        <p className="text-sm text-muted-foreground mb-1">
          Drag and drop your image here
        </p>
        <p className="text-sm text-muted-foreground mb-1">or click to browse</p>
        <p className="text-xs text-muted-foreground">
          Images (JPEG, PNG) up to {maxSizeMB}MB
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
