import { toast } from "sonner";

export async function copyShareLinkToClipboard(shareUrl: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareUrl);
    toast.success("Link copied to clipboard");
  } catch (copyError) {
    console.error(
      "[copyShareLinkToClipboard] Clipboard write failed:",
      copyError instanceof Error ? copyError.message : copyError,
    );
    toast.error("Could not copy the link. Your browser blocked clipboard access.");
  }
}
