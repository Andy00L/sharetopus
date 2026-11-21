import "server-only";

import sharp from "sharp";

// TikTok photo limits: WebP or JPEG, at most 1080p, at most 20MB per image:
// https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
// A larger photo fails with fail_reason picture_size_check_failed:
// https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
// 1080p is read as 1080 on the short side and 1920 on the long side.
const TIKTOK_PHOTO_SHORT_SIDE_MAX = 1080;
const TIKTOK_PHOTO_LONG_SIDE_MAX = 1920;
const TIKTOK_PHOTO_JPEG_QUALITY = 90;

// EXIF Orientation values 5 to 8 rotate the image by 90 or 270 degrees:
// https://exiftool.org/TagNames/EXIF.html (tag 0x0112)
const FIRST_ROTATED_EXIF_ORIENTATION = 5;

export type FitPhotoResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; message: string };

export async function fitPhotoForTikTok(
  photoBytes: Buffer,
): Promise<FitPhotoResult> {
  try {
    const metadata = await sharp(photoBytes).metadata();
    const isStoredRotated =
      (metadata.orientation ?? 1) >= FIRST_ROTATED_EXIF_ORIENTATION;
    const displayedWidth = isStoredRotated ? metadata.height : metadata.width;
    const displayedHeight = isStoredRotated ? metadata.width : metadata.height;
    if (!displayedWidth || !displayedHeight) {
      return { ok: false, message: "Could not read the photo's dimensions." };
    }

    const isLandscape = displayedWidth >= displayedHeight;
    const bytes = await sharp(photoBytes)
      .rotate()
      .resize({
        width: isLandscape ? TIKTOK_PHOTO_LONG_SIDE_MAX : TIKTOK_PHOTO_SHORT_SIDE_MAX,
        height: isLandscape ? TIKTOK_PHOTO_SHORT_SIDE_MAX : TIKTOK_PHOTO_LONG_SIDE_MAX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: TIKTOK_PHOTO_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    return { ok: true, bytes };
  } catch (error) {
    console.error(
      "[fitPhotoForTikTok] Could not process the photo:",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, message: "Could not prepare the photo for TikTok." };
  }
}
