import { DEFAULT_SCHEDULED_TIME } from "./defaults";

/** yyyy-MM-dd, the format the calendar's quick-create links emit. */
const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** HH:mm, 24h. */
const TIME_PARAM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type SchedulePrefill = { date: string; time: string };

/**
 * Validates ?date=&time= query params (from calendar quick-create links)
 * into a schedule prefill. Returns null for anything malformed or already
 * in the past, so a stale or hand-edited link degrades to the normal
 * unscheduled form instead of an invalid state.
 */
export function parseSchedulePrefill(
  dateParam: string | undefined,
  timeParam: string | undefined,
): SchedulePrefill | null {
  if (!dateParam || !DATE_PARAM_PATTERN.test(dateParam)) {
    return null;
  }
  const time =
    timeParam && TIME_PARAM_PATTERN.test(timeParam)
      ? timeParam
      : DEFAULT_SCHEDULED_TIME;

  const targetMoment = new Date(`${dateParam}T${time}`);
  if (
    Number.isNaN(targetMoment.getTime()) ||
    targetMoment.getTime() <= Date.now()
  ) {
    return null;
  }
  return { date: dateParam, time };
}
