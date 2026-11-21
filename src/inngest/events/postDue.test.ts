import { describe, expect, test } from "bun:test";

import {
  planPostDueEvents,
  POST_DUE_LOOKAHEAD_MS,
  POST_DUE_OVERDUE_GRACE_MS,
  type PostDueTarget,
} from "./postDue";

const MINUTE_MS = 60 * 1000;
const NOW_MS = Date.parse("2026-11-20T10:00:00.000Z");

function buildTarget(scheduledAt: string): PostDueTarget {
  return {
    id: "post-1",
    principal_id: "principal-1",
    social_account_id: "account-1",
    platform: "linkedin",
    scheduled_at: scheduledAt,
  };
}

function planOne(scheduledAt: string, nowMs: number) {
  return planPostDueEvents({ targets: [buildTarget(scheduledAt)], nowMs });
}

function isoAfterNow(offsetMs: number): string {
  return new Date(NOW_MS + offsetMs).toISOString();
}

describe("planPostDueEvents", () => {
  test("a post due within the lookahead fires at its own time", () => {
    const scheduledAt = isoAfterNow(90 * MINUTE_MS);
    const [planned] = planOne(scheduledAt, NOW_MS);
    expect(planned.timing).toBe("on_time");
    expect(planned.event.ts).toBe(Date.parse(scheduledAt));
    expect(planned.event.id).toBe(`post.due-post-1-${Date.parse(scheduledAt)}`);
    expect(planned.event.data).toEqual({
      scheduled_post_id: "post-1",
      principal_id: "principal-1",
      social_account_id: "account-1",
      platform: "linkedin",
      scheduled_at: scheduledAt,
    });
  });

  test("a post due after the lookahead is left to a later safety-net run", () => {
    expect(planOne(isoAfterNow(POST_DUE_LOOKAHEAD_MS + 1), NOW_MS)).toEqual([]);
  });

  test("an unreadable scheduled_at sends no event instead of one that fires now", () => {
    expect(planOne("not a timestamp", NOW_MS)).toEqual([]);
  });

  test("every send for one scheduled time carries the same id, whatever the text form", () => {
    const dueAtMs = NOW_MS + 30 * MINUTE_MS;
    const fromSender = planOne(new Date(dueAtMs).toISOString(), dueAtMs - 100 * MINUTE_MS);
    const fromSafetyNet = planOne(
      new Date(dueAtMs).toISOString().replace(".000Z", "+00:00"),
      dueAtMs - 40 * MINUTE_MS,
    );
    expect(fromSafetyNet[0].event.id).toBe(fromSender[0].event.id);
    expect(fromSafetyNet[0].event.ts).toBe(dueAtMs);
  });

  test("a rescheduled post gets a new id, so its new trigger is not deduplicated", () => {
    const [beforeReschedule] = planOne(isoAfterNow(30 * MINUTE_MS), NOW_MS);
    const [afterReschedule] = planOne(isoAfterNow(60 * MINUTE_MS), NOW_MS);
    expect(afterReschedule.event.id).not.toBe(beforeReschedule.event.id);
  });

  test("a post just past due keeps its on-time id and fires now", () => {
    const [planned] = planOne(isoAfterNow(-5 * MINUTE_MS), NOW_MS);
    expect(planned.timing).toBe("on_time");
    expect(planned.event.ts).toBeUndefined();
  });

  test("an overdue post gets a fresh id per safety-net run, stable across that run's retries", () => {
    const scheduledAt = isoAfterNow(-POST_DUE_OVERDUE_GRACE_MS - MINUTE_MS);
    const [firstRun] = planOne(scheduledAt, NOW_MS);
    const [firstRunRetry] = planOne(scheduledAt, NOW_MS);
    const [nextHourRun] = planOne(scheduledAt, NOW_MS + 60 * MINUTE_MS);
    const [onTime] = planOne(scheduledAt, Date.parse(scheduledAt));

    expect(firstRun.timing).toBe("late");
    expect(firstRun.event.ts).toBeUndefined();
    expect(firstRunRetry.event.id).toBe(firstRun.event.id);
    expect(nextHourRun.event.id).not.toBe(firstRun.event.id);
    expect(firstRun.event.id).not.toBe(onTime.event.id);
  });
});
