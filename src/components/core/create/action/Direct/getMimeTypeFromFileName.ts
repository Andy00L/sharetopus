// Define a more specific type for MIME types

// Or even more specifically, create a union type of allowed MIME types
type MediaMimeType =
  | "video/mp4"
  | "video/mov"
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "application/octet-stream";
export function getMimeTypeFromFileName(fileName?: string): MediaMimeType {
  // Add detailed logging to diagnose the issue
  console.log("[GetMimeTypeFileName] Processing filename:", fileName);

  if (!fileName) {
    console.log(
      "[GetMimeTypeFileName] No filename provided, using default MIME type"
    );
    return "application/octet-stream";
  }

  // Convert to lowercase for more reliable matching
  const lowerFileName = fileName.toLowerCase();
  console.log("[GetMimeTypeFileName] Lowercase filename:", lowerFileName);

  // Extract extension more reliably - handle the actual file extension explicitly
  if (lowerFileName.endsWith(".mp4")) {
    console.log("[GetMimeTypeFileName] Detected MP4 file");
    return "video/mp4";
  } else if (
    lowerFileName.endsWith(".jpg") ||
    lowerFileName.endsWith(".jpeg")
  ) {
    console.log("[GetMimeTypeFileName] Detected JPEG file");
    return "image/jpeg";
  } else if (lowerFileName.endsWith(".png")) {
    console.log("[GetMimeTypeFileName] Detected PNG file");
    return "image/png";
  } else if (lowerFileName.endsWith(".gif")) {
    console.log("[GetMimeTypeFileName] Detected GIF file");
    return "image/gif";
  } else if (lowerFileName.endsWith(".mov")) {
    console.log("[GetMimeTypeFileName] Detected MOV file");
    return "video/mov";
  }

  // Fall back to extension extraction if direct matching doesn't work
  const extension = lowerFileName.split(".").pop();
  console.log("[GetMimeTypeFileName] Extracted extension:", extension);

  // Map extensions to MIME types
  const mimeTypeMap: Record<string, MediaMimeType> = {
    mp4: "video/mp4",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    mov: "video/mov",
  };

  // Look up the MIME type or return default
  const mimeType =
    extension && extension in mimeTypeMap
      ? mimeTypeMap[extension]
      : "application/octet-stream";

  console.log("[GetMimeTypeFileName] Determined MIME type:", mimeType);
  return mimeType;
}
