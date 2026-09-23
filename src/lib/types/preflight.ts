/**
 * Outcome of a pre-payment check: whether a request would pass the business
 * rules of the action it pays for (ownership, eligibility, quotas, duplicate
 * keys) before any money moves.
 *
 * Returned by the preflight helpers in src/actions/server/* and consumed by
 * the x402 paid middleware's precheck step.
 */
export type PreflightResult =
  | { ok: true }
  | { ok: false; httpStatus: number; errorKind: string; message: string };
