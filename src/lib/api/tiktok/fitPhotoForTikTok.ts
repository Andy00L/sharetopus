import "server-only";

import sharp from "sharp";

/**
 * TikTok photo limits: JPEG or WebP, at most 1080p, at most 20MB per image
 * (developers.tiktok.com/doc/content-posting-api-media-transfer-guide). A
 * larger photo is refused with picture_size_check_failed, which is what a
 * 4032x3024 phone photo gets. 1080p is read as 1080 on the short side and
 * 1920 on the long side, the 9:16 and 16:9 frames TikTok itself uses.
 */
const TIKTOK_PHOTO_SHORT_SIDE_MAX = 1080;
const TIKTOK_PHOTO_LONG_SIDE_MAX = 1920;
/** High enough that the resize is invisible, far under the 20MB cap at 1080p. */
const TIKTOK_PHOTO_JPEG_QUALITY = 90;

/** EXIF orientations 5 to 8 store the image rotated 90 degrees. */
const FIRST_ROTATED_EXIF_ORIENTATION = 5;

export type FitPhotoResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; message: string };

/**
 * Turns a stored photo into one TikTok accepts: applies the EXIF rotation,
 * shrinks it (never enlarges) to fit 1080p in its own orientation, and
 * re-encodes it as JPEG. Only TikTok receives the result; the stored file
 * other platforms use is untouched.
 */
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
