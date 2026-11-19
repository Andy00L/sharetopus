/** A platform whose daily cap the batch would pass. */
export type DailyQuotaViolation = {
  platform: string;
  existingCount: number;
  addedCount: number;
  dailyCap: number;
};

/** How many posts of the batch go to each platform, in first-seen order. */
export function countPostsByPlatform(
  posts: { platform: string }[],
): Map<string, number> {
  const postCountByPlatform = new Map<string, number>();
  for (const post of posts) {
    postCountByPlatform.set(
      post.platform,
      (postCountByPlatform.get(post.platform) ?? 0) + 1,
    );
  }
  return postCountByPlatform;
}

/**
 * The first platform, in batch order, where the posts already due in the
 * window plus the new ones pass the daily cap. A platform without a
 * platform_quotas row gets defaultDailyCap. Null when every platform fits.
 */
export function findDailyQuotaViolation(input: {
  addedCountByPlatform: Map<string, number>;
  existingCountByPlatform: Map<string, number>;
  dailyCapByPlatform: Map<string, number>;
  defaultDailyCap: number;
}): DailyQuotaViolation | null {
  for (const [platform, addedCount] of input.addedCountByPlatform) {
    const existingCount = input.existingCountByPlatform.get(platform) ?? 0;
    const dailyCap =
      input.dailyCapByPlatform.get(platform) ?? input.defaultDailyCap;
    if (existingCount + addedCount > dailyCap) {
      return { platform, existingCount, addedCount, dailyCap };
    }
  }
  return null;
}
