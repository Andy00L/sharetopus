import "server-only";

/**
 * Returns a Date that is guaranteed to be in the future.
 *
 * If the input is already in the future, returns it unchanged.
 * If the input is in the past or now, returns `now() + 1 hour`.
 *
 * Used when resuming cancelled posts whose original scheduled_at has
 * elapsed during the cancellation period. The 1-hour buffer gives the
 * dispatcher time to pick up the post and gives the user time to
 * cancel again if they did not intend to resume.
 */
export function bumpPastScheduleToFuture(scheduledAt: string | Date): Date {
  const target =
    scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);

  if (target.getTime() > Date.now()) {
    return target;
  }
  return new Date(Date.now() + 60 * 60 * 1000);
}
