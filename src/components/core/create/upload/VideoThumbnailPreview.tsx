// components/upload/VideoThumbnailPreview.tsx
"use client";

import FilePreview from "@/components/renderFilePreview";

interface VideoThumbnailPreviewProps {
  readonly thumbnailUrl: string | null;
  readonly selectedFile: File | null;
  readonly onReplaceMedia: () => void;
  readonly onSetCoverImage: () => void;
}

export function VideoThumbnailPreview({
  thumbnailUrl,
  onReplaceMedia,
  onSetCoverImage,
  selectedFile,
}: VideoThumbnailPreviewProps) {
  return (
    <div className="border-2 border-dashed rounded-lg p-4 transition-colors border-muted-foreground/20">
      <div className="flex flex-row items-start">
        <div className=" w-32 h-34 mr-4">
          <FilePreview
            mediaType={"image"}
            previewUrl={thumbnailUrl}
            selectedFile={selectedFile}
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center"></div>
      </div>

      <div className="flex items-center justify-between gap-4 mt-2">
        <button
          onClick={onReplaceMedia}
          className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M3 16V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V16M16 8L12 4M12 4L8 8M12 4V16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Replace Media
        </button>
        <button
          onClick={onSetCoverImage}
          className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 16L8.58579 11.4142C9.36684 10.6332 10.6332 10.6332 11.4142 11.4142L16 16M14 14L15.5858 12.4142C16.3668 11.6332 17.6332 11.6332 18.4142 12.4142L20 14M14 8H14.01M3 19H21C21.5523 19 22 18.5523 22 18V6C22 5.44772 21.5523 5 21 5H3C2.44772 5 2 5.44772 2 6V18C2 18.5523 2.44772 19 3 19Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Set Cover Image
        </button>
      </div>
    </div>
  );
}
