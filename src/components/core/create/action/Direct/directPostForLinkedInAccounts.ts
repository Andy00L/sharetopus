// createPostForm/action/directPostForLinkedInAccounts.ts
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";

/**
 * Result interface for direct posting operations
 */
export interface DirectPostResult {
  success: boolean;
  count: number;
  message?: string;
}

/**
 * Directly posts content to LinkedIn accounts without scheduling
 * Converts the file to base64 and sends it to the LinkedIn API
 */
export async function directPostForLinkedInAccounts(config: {
  accounts: SocialAccount[];
  file?: File;
  platformOptions: PlatformOptions;
  accountContent: Array<{
    accountId: string;
    title?: string;
    description: string;
    link: string;
    isCustomized: boolean;
  }>;
  onProgress?: (progress: number) => void;
}): Promise<DirectPostResult> {
  const { accounts, file, accountContent, onProgress } = config;

  let successCount = 0;
  const totalAccounts = accounts.length;

  try {
    console.log("[LinkedIn Direct Post] Starting to post directly to LinkedIn");

    // Convert the file to base64 (only if provided)
    let base64Media: string | undefined;
    let mediaType: string | undefined;

    if (file) {
      base64Media = await fileToBase64(file);
      mediaType = file.type;
      console.log("[LinkedIn Direct Post] Converted file to base64");
    }

    // Track progress for each account
    let completedAccounts = 0;

    for (const account of accounts) {
      // Find content specific to this account
      const content = accountContent.find(
        (item) => item.accountId === account.id
      );

      // Skip if no content found for this account
      if (!content) {
        console.error(
          `[LinkedIn Direct Post] No content found for account ${account.id}`
        );
        completedAccounts++;
        onProgress?.(Math.floor((completedAccounts / totalAccounts) * 100));
        continue;
      }

      // Verify access token is available
      if (!account.access_token) {
        console.error(
          `[LinkedIn Direct Post] No access token for account ${account.id}`
        );

        completedAccounts++;
        onProgress?.(Math.floor((completedAccounts / totalAccounts) * 100));
        continue;
      }

      // Get member URN from the account identifier
      const memberUrn = account.account_identifier
        ? `urn:li:person:${account.account_identifier}`
        : null;

      if (!memberUrn) {
        console.error(
          `[LinkedIn Direct Post] No LinkedIn member URN found for account ${account.id}`
        );

        completedAccounts++;
        onProgress?.(Math.floor((completedAccounts / totalAccounts) * 100));
        continue;
      }

      try {
        console.log(
          `[LinkedIn Direct Post] Posting to account: ${
            account.username ?? account.id
          }`
        );

        // Call our API endpoint to post to LinkedIn
        const postResult = await fetch("/api/social/post/linkedin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            accessToken: account.access_token,
            memberUrn: memberUrn,
            text: content.description,
            link: content.link,
            base64Media: base64Media,
            mediaType: mediaType,
          }),
        });

        const resultData = await postResult.json();

        if (!postResult.ok || !resultData.success) {
          console.error(
            `[LinkedIn Direct Post] Failed to post for account ${account.id}:`,
            resultData.error
          );
        } else {
          successCount++;
          console.log(
            `[LinkedIn Direct Post] Successfully posted to account: ${
              account.username ?? account.id
            }`
          );
        }
      } catch (postError) {
        console.error(
          `[LinkedIn Direct Post] Error for account ${account.id}:`,
          postError
        );
      }

      // Update progress after each account is processed
      completedAccounts++;
      onProgress?.(Math.floor((completedAccounts / totalAccounts) * 100));
    }

    return {
      success: successCount > 0,
      count: successCount,
      message: `Successfully posted to ${successCount} LinkedIn account(s)`,
    };
  } catch (error) {
    console.error("[LinkedIn Direct Post] Error:", error);
    return {
      success: false,
      count: 0,
      message: `Failed to post to LinkedIn: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Helper function to convert a File object to a base64 string
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64String = reader.result as string;
      // Extract just the base64 data part
      const base64 = base64String.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
