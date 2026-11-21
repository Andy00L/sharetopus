import { isSignedStorageUrl, type SignedStorageUrl } from "./signedStorageUrl";

export const FIXTURE_STORAGE_BASE_URL = "https://project.supabase.test";

export function buildSignedStorageUrlFixture(objectPath: string): SignedStorageUrl {
  const candidateUrl = `${FIXTURE_STORAGE_BASE_URL}/storage/v1/object/sign/media/${objectPath}?token=fixture`;
  if (!isSignedStorageUrl(candidateUrl, FIXTURE_STORAGE_BASE_URL)) {
    throw new Error(`[buildSignedStorageUrlFixture] ${candidateUrl} is not a signed storage URL`);
  }
  return candidateUrl;
}
