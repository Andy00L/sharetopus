const FORBIDDEN_PATH_SEGMENTS = new Set(["", ".", ".."]);

const FORBIDDEN_PATH_CHARACTERS = /[%\\]/;

export function isOwnedMediaPath(storagePath: string, principalId: string): boolean {
  if (principalId.length === 0 || !storagePath.startsWith(`${principalId}/`)) return false;
  if (FORBIDDEN_PATH_CHARACTERS.test(storagePath)) return false;
  return storagePath
    .split("/")
    .every((pathSegment) => !FORBIDDEN_PATH_SEGMENTS.has(pathSegment));
}
