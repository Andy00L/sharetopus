// undici's fetch reports every network failure as "fetch failed" and keeps
// the reason on error.cause. sourceRef: node_modules/undici/lib/web/fetch/index.js
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown network error";
  const cause = error.cause;
  if (!(cause instanceof Error)) return error.message;
  const causeCode =
    "code" in cause && typeof cause.code === "string" ? cause.code : null;
  return `${error.message} (${causeCode ?? cause.message})`;
}
