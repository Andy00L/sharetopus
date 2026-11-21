const SUBREDDIT_NAME_PATTERN = /^[A-Za-z0-9_]{2,21}$/;

export function normalizeSubredditName(rawName: string): string | null {
  const subredditName = rawName.trim().replace(/^\/?r\//i, "");
  return SUBREDDIT_NAME_PATTERN.test(subredditName) ? subredditName : null;
}
