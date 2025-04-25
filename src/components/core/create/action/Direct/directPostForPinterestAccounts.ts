// createPostForm/action/directPostForPinterestAccounts.ts
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
 * Directly posts content to Pinterest accounts without scheduling
 * Converts the file to base64 and sends it to the Pinterest API
 */
export async function directPostForPinterestAccounts(config: {
  accounts: SocialAccount[];
  file: File;
  boards: Array<{
    boardID: string;
    boardName: string;
    accountId: string;
    isSelected: boolean;
  }>;
  platformOptions: PlatformOptions;
  accountContent: Array<{
    accountId: string;
    title: string;
    description: string;
    link: string;
    isCustomized: boolean;
  }>;
  onProgress?: (progress: number) => void;
}): Promise<DirectPostResult> {
  const {
    accounts,
    file,
    boards,
    accountContent,

    onProgress,
  } = config;

  let successCount = 0;
  const totalAccounts = accounts.length;

  try {
    console.log(
      "[Pinterest Direct Post] Starting to post directly to Pinterest"
    );

    // Convert the file to base64 once (rather than for each account)
    const base64Media = await fileToBase64(file);
    console.log("[Pinterest Direct Post] Converted file to base64");

    // Track progress for each account
    let completedAccounts = 0;

    for (const account of accounts) {
      // Find content specific to this account
      const content = accountContent.find(
        (item) => item.accountId === account.id
      );
      console.log("content", content?.description);
      // Skip if no content found for this account
      if (!content) {
        console.error(
          `[Pinterest Direct Post] No content found for account ${account.id}`
        );
        completedAccounts++;
        onProgress?.(Math.floor((completedAccounts / totalAccounts) * 100));
        continue;
      }

      // Get the selected board for this account
      const selectedBoard = boards.find(
        (board) => board.isSelected && board.accountId === account.id
      );

      if (!selectedBoard) {
        console.error(
          `[Pinterest Direct Post] No board selected for account ${account.id}`
        );
        completedAccounts++;
        onProgress?.(Math.floor((completedAccounts / totalAccounts) * 100));
        continue;
      }

      // Verify access token is available
      if (!account.access_token) {
        console.error(
          `[Pinterest Direct Post] No access token for account ${account.id}`
        );

        completedAccounts++;
        onProgress?.(Math.floor((completedAccounts / totalAccounts) * 100));
        continue;
      }

      try {
        console.log(
          `[Pinterest Direct Post] Posting to account: ${
            account.username ?? account.id
          }`
        );

        // Call our API endpoint to post to Pinterest
        const postResult = await fetch("/api/social/post/pinterest", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            accessToken: account.access_token,
            boardId: selectedBoard.boardID,
            title: content.title,
            description: content.description,
            link: content.link,
            base64Media,
            mediaType: file.type,
          }),
        });

        const resultData = await postResult.json();

        if (!postResult.ok || !resultData.success) {
          console.error(
            `[Pinterest Direct Post] Failed to post for account ${account.id}:`,
            resultData.error
          );
        } else {
          successCount++;
          console.log(
            `[Pinterest Direct Post] Successfully posted to account: ${
              account.username ?? account.id
            }`
          );
        }
      } catch (postError) {
        console.error(
          `[Pinterest Direct Post] Error for account ${account.id}:`,
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
      message: `Successfully posted to ${successCount} Pinterest account(s)`,
    };
  } catch (error) {
    console.error("[Pinterest Direct Post] Error:", error);
    return {
      success: false,
      count: 0,
      message: `Failed to post to Pinterest: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Helper function to convert a File object to a base64 string
 * Removes the data URL prefix (e.g., "data:image/jpeg;base64,")
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
