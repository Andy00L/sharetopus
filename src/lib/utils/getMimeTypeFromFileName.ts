type MediaMimeType =
  | "video/mp4"
  | "video/mov"
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "application/octet-stream";

type MimeTypeResult = {
  success: boolean;
  mimeType: MediaMimeType;
  message?: string;
};
export function getMimeTypeFromFileName(fileName?: string): MimeTypeResult {
  if (!fileName) {
    return {
      success: false,
      mimeType: "application/octet-stream",
      message: "No filename provided",
    };
  }

  const extension = fileName.toLowerCase().split(".").pop();
  if (!extension) {
    console.log("[GetMimeTypeFileName] No extension found in filename");
    return {
      success: false,
      mimeType: "application/octet-stream",
      message: "No file extension found",
    };
  }

  const mimeTypeMap: Record<string, MediaMimeType> = {
    mp4: "video/mp4",
    mov: "video/mov",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
  };

  const mimeType = mimeTypeMap[extension];

  if (!mimeType) {
    console.log(`[GetMimeTypeFileName] Unsupported extension: ${extension}`);
    return {
      success: false,
      mimeType: "application/octet-stream",
      message: `Unsupported file type: .${extension}`,
    };
  }

  return {
    success: true,
    mimeType,
  };
}
