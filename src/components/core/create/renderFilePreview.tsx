import { AlertCircle } from "lucide-react";
import Image from "next/image";

interface FilePreviewProps {
  readonly selectedFile: File | null;
  readonly mediaType: "image" | "video" | "text" | null;
  readonly previewUrl: string | null;
}

export default function FilePreview({
  selectedFile,
  mediaType,
  previewUrl,
}: FilePreviewProps) {
  if (!selectedFile || !previewUrl) return null;

  return (
    <div className="rounded-lg overflow-hidden bg-black relative">
      {mediaType === "image" && (
        <Image
          src={previewUrl}
          width={640}
          height={480}
          alt="Preview"
          className="w-full h-64 object-contain"
        />
      )}
      {mediaType === "video" && (
        <video
          src={previewUrl}
          controls
          className="w-full h-64 object-contain"
        ></video>
      )}
      {!mediaType && (
        <div className="w-full h-64 bg-muted flex items-center justify-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
