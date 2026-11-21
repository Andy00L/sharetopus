const UNSAFE_FILE_NAME_CHARACTERS = /[^A-Za-z0-9._-]/g;

export function toUploadFileName(fileName: string, fallbackName: string): string {
  return fileName.replace(UNSAFE_FILE_NAME_CHARACTERS, "_") || fallbackName;
}
