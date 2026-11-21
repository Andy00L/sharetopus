import type { MediaType } from "@/db/schema";
import {
  PLATFORM_LABELS,
  platformSupportsMediaType,
  type AdapterPlatform,
} from "@/lib/platforms/capabilities";
import { ClientSocialAccount } from "@/lib/types/dbTypes";
import { AccountError, BoardInfo, ContentInfo } from "./handleSocialMediaPost";

export function validateAccountContent(
  accounts: ClientSocialAccount[],
  accountContent: ContentInfo[],
  platform: AdapterPlatform,
  boards: BoardInfo[] | undefined,
  postType: MediaType,
): AccountError[] {
  const errors: AccountError[] = [];

  accounts.forEach((account) => {
    const content = accountContent.find((contentEntry) => contentEntry.accountId === account.id);
    const displayName = account.display_name ?? account.username ?? account.id;

    if (!platformSupportsMediaType(platform, postType)) {
      errors.push({
        accountId: account.id,
        platform,
        displayName,
        error: `${PLATFORM_LABELS[platform]} does not support ${postType} posts`,
      });
      return;
    }

    if (!content) {
      errors.push({
        accountId: account.id,
        platform,
        displayName,
        error: "No content configured for this account",
      });
      return;
    }

    if (platform === "pinterest" && postType !== "text") {
      const hasSelectedBoard = boards?.some(
        (board) => board.accountId === account.id && board.isSelected,
      );
      if (!hasSelectedBoard) {
        errors.push({
          accountId: account.id,
          platform,
          displayName,
          error: "No board selected for this account",
        });
      }
    }

    if (platform === "linkedin" && !account.account_identifier) {
      errors.push({
        accountId: account.id,
        platform,
        displayName,
        error: "No LinkedIn identifier found for this account",
      });
    }
  });

  return errors;
}
