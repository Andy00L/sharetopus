export type SignedStorageUrl = string & { readonly __brand: "SignedStorageUrl" };

// @supabase/storage-js createSignedUrl answers
// `${supabaseUrl}/storage/v1/object/sign/<bucket>/<path>?token=<jwt>`.
const SIGNED_OBJECT_PATH_PREFIX = "/storage/v1/object/sign/";

export function isSignedStorageUrl(
  candidateUrl: string,
  storageBaseUrl: string,
): candidateUrl is SignedStorageUrl {
  try {
    const parsedUrl = new URL(candidateUrl);
    return (
      parsedUrl.origin === new URL(storageBaseUrl).origin &&
      parsedUrl.pathname.startsWith(SIGNED_OBJECT_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}
