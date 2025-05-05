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
    <>
      {mediaType === "image" && (
        <Image
          src={previewUrl}
          width={640}
          height={480}
          alt="Preview"
          className="w-full h-[420px] object-contain"
        />
      )}
      {mediaType === "video" && (
        <video
          src={previewUrl}
          controls
          autoPlay
          loop
          muted
          className="w-full h-[420px] object-contain"
        ></video>
      )}
      {!mediaType && (
        <div className="w-full h-[420px] bg-muted flex items-center justify-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
        </div>
      )}
    </>
  );
}

//collors #EEEFE8 #F3F4EF
