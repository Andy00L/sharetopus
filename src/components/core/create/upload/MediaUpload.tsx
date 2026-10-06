"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
} from "@/components/core/create/constants/constants";

const UPLOAD_COPY = {
  image: {
    title: "Upload Image",
    dropHint: "Drag and drop your image here",
    formats: "Images (JPEG, PNG)",
    acceptedTypes: ALLOWED_IMAGE_TYPES,
  },
  video: {
    title: "Upload Video",
    dropHint: "Drag and drop your video here",
    formats: "Videos (MP4, MOV)",
    acceptedTypes: ALLOWED_VIDEO_TYPES,
  },
} as const;

interface MediaUploadProps {
  readonly kind: "image" | "video";
  readonly onFileSelected: (file: File) => void;
  readonly maxSizeMB: number;
}

/** Click-or-drop area that hands the chosen image or video file to the parent. */
export function MediaUpload({ kind, onFileSelected, maxSizeMB }: MediaUploadProps) {
  const copy = UPLOAD_COPY[kind];
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Child elements fire their own enter/leave events; the counter tells a real leave apart.
  const dragDepth = useRef(0);

  const stopBrowserDefault = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    stopBrowserDefault(event);
    dragDepth.current += 1;
    if (dragDepth.current === 1) setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    stopBrowserDefault(event);
    dragDepth.current -= 1;
    if (dragDepth.current === 0) setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    stopBrowserDefault(event);
    dragDepth.current = 0;
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFileSelected(file);
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Upload ${kind} area`}
      className={`border-2 border-dashed bg-card rounded-lg p-12 text-center transition-colors cursor-pointer ${
        isDragging
          ? "border-primary bg-primary/5 "
          : "border-muted-foreground/20 hover:border-primary/50 hover:bg-accent"
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={stopBrowserDefault}
      onDrop={handleDrop}
      onClick={openFilePicker}
      onKeyDown={handleKeyDown}
    >
      <div className="w-full h-full flex flex-col items-center justify-center">
        <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium text-lg mb-2">{copy.title}</h3>
        <p className="text-sm text-muted-foreground mb-1">{copy.dropHint}</p>
        <p className="text-sm text-muted-foreground mb-1">or click to browse</p>
        <p className="text-xs text-muted-foreground">
          {copy.formats} up to {maxSizeMB}MB
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={copy.acceptedTypes.join(",")}
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
