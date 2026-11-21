import { DEFAULT_SCHEDULED_TIME } from "./defaults";

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PARAM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type SchedulePrefill = { date: string; time: string };

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
