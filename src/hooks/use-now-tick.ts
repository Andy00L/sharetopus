"use client";

import { useEffect, useState } from "react";

/**
 * Re-renders on a fixed interval and returns the current time, so
 * time-anchored UI (the calendar's now line) stays current while the page
 * sits open. The interval synchronizes React with the wall clock, a system
 * React does not own; cleanup clears the timer.
 */
export function useNowTick(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timerId);
  }, [intervalMs]);

  return now;
}
