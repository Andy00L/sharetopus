// components/upload/ImagePreview.tsx
"use client";

interface ImagePreviewProps {
  imageUrl: string;
  className?: string;
}

export function ImagePreview({ imageUrl, className = "" }: ImagePreviewProps) {
  return (
    <div className={`border-2 rounded-lg p-4 text-center ${className}`}>
      <div className="w-full flex flex-col items-center justify-center">
        <img
          src={imageUrl}
          alt="Image preview"
          className="max-w-full max-h-80 object-contain rounded"
        />
      </div>
    </div>
  );
}
