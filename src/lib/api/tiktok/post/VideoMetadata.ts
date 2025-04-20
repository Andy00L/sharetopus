// lib/utils/videoMetadata.ts

/**
 * Video metadata interface
 */
export interface VideoMetadata {
  size: number; // Size in bytes
  duration: number; // Duration in seconds
  format: string; // File format (e.g., "mp4")
}

/**
 * Simple function to extract basic video metadata
 * For production use, consider using a more robust solution
 * like ffprobe or a dedicated video processing library
 *
 * @param videoBuffer Video file as a Buffer
 * @param fileName Original file name (for format detection)
 * @returns Video metadata with estimated values
 */
export function getVideoMetadataSimple(
  videoBuffer: Buffer,
  fileName: string
): VideoMetadata {
  // Get file format from filename extension
  const format = fileName.split(".").pop()?.toLowerCase() ?? "mp4";

  // Get file size in bytes
  const size = videoBuffer.length;

  // Estimate duration based on file size (very rough estimate)
  // Assuming ~1MB per 5 seconds of video at moderate quality
  const estimatedDuration = Math.ceil((size / (1024 * 1024)) * 5);

  // Ensure reasonable bounds
  const duration = Math.min(Math.max(estimatedDuration, 5), 180);

  return {
    size,
    duration,
    format,
  };
}
