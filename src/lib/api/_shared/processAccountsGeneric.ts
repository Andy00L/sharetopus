import "server-only";
import type { SocialAccount } from "@/lib/types/dbTypes";
import type { Platform } from "@/lib/types/database.types";
import type {
  AccountError,
  ContentInfo,
} from "@/components/core/create/action/handleSocialMediaPost/handleSocialMediaPost";

export type ProcessAccountsResult = {
  successCount: number;
  errors: AccountError[];
};

export type ProcessAccountsConfig<TExtra> = {
  platform: Platform;
  logPrefix: string;
  accounts: SocialAccount[];
  accountContent: ContentInfo[];
  isScheduled: boolean;
  postType: "image" | "video" | "text";
  skipBatch?: boolean;
  resolvePerAccount: (
    account: SocialAccount
  ) => { ok: true; extra: TExtra } | { ok: false; error: string };
  callScheduled: (args: {
    account: SocialAccount;
    accountContent: ContentInfo;
    extra: TExtra;
  }) => Promise<{ success: boolean; count: number; message?: string }>;
  buildDirectPostBody: (args: {
    account: SocialAccount;
    accountContent: ContentInfo;
    extra: TExtra;
  }) => Record<string, unknown>;
  directPostEndpoint: string;
};

export async function processAccountsGeneric<TExtra>(
  config: ProcessAccountsConfig<TExtra>
): Promise<ProcessAccountsResult> {
  const { accounts, isScheduled, logPrefix, skipBatch } = config;
  const errors: AccountError[] = [];
  let successCount = 0;

  if (accounts.length === 0 || skipBatch) {
    return { successCount, errors };
  }

  console.log(`${logPrefix} Processing ${accounts.length} accounts`);

  const accountPromises = accounts.map(async (account) => {
    try {
      console.log(
        `${logPrefix} Processing account: ${
          account.display_name ?? account.username ?? account.id
        }`
      );

      const accountContent = config.accountContent.find(
        (c) => c.accountId === account.id
      );
      if (!accountContent) {
        return {
          success: false as const,
          error: {
            accountId: account.id,
            platform: config.platform,
            displayName:
              account.display_name ?? account.username ?? account.id,
            error: "No content configured for this account",
          },
        };
      }

      const resolved = config.resolvePerAccount(account);
      if (!resolved.ok) {
        return {
          success: false as const,
          error: {
            accountId: account.id,
            platform: config.platform,
            displayName:
              account.display_name ?? account.username ?? account.id,
            error: resolved.error,
          },
        };
      }

      const accountStartTime = performance.now();
      const result = isScheduled
        ? await config.callScheduled({
            account,
            accountContent,
            extra: resolved.extra,
          })
        : await fetch(config.directPostEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              config.buildDirectPostBody({
                account,
                accountContent,
                extra: resolved.extra,
              })
            ),
          }).then((res) => res.json());

      const accountProcessingTime = performance.now() - accountStartTime;
      console.log(
        `${logPrefix} Processed account ${
          account.id
        } in ${accountProcessingTime.toFixed(2)}ms: ${
          result.success ? "Success" : "Failed"
        }`
      );

      if (result.success && result.count > 0) {
        return { success: true as const };
      }
      return {
        success: false as const,
        error: {
          accountId: account.id,
          platform: config.platform,
          displayName:
            account.display_name ?? account.username ?? account.id,
          error: result.message ?? "Failed to process account",
        },
      };
    } catch (error) {
      console.error(
        `${logPrefix} Error processing account ${account.id}:`,
        error
      );
      return {
        success: false as const,
        error: {
          accountId: account.id,
          platform: config.platform,
          displayName:
            account.display_name ?? account.username ?? account.id,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  const results = await Promise.all(accountPromises);
  results.forEach((r) => {
    if (r.success) successCount++;
    else if (r.error) errors.push(r.error);
  });

  console.log(
    `${logPrefix} Completed with ${successCount} successes and ${errors.length} failures`
  );
  return { successCount, errors };
}
