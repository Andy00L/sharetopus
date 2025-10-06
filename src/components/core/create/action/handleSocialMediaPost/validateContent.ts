import { SocialAccount } from "@/lib/types/dbTypes";
import { AccountError, BoardInfo, ContentInfo } from "./handleSocialMediaPost";

export function validateAccountContent(
  accounts: SocialAccount[],
  accountContent: ContentInfo[],
  platform: string,
  boards?: BoardInfo[],
  postType?: string
): AccountError[] {
  const errors: AccountError[] = [];

  accounts.forEach((account) => {
    const content = accountContent.find((c) => c.accountId === account.id);
    const displayName = account.display_name ?? account.username ?? account.id;

    if (!content) {
      errors.push({
        accountId: account.id,
        platform,
        displayName,
        error: "No content configured for this account",
      });
      return;
    }

    // Platform-specific validations
    if (platform === "pinterest" && postType !== "text") {
      const hasSelectedBoard = boards?.some(
        (b) => b.accountId === account.id && b.isSelected
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
