"use client";

import { useMemo, useSyncExternalStore } from "react";

function createTickingClock(intervalMs: number) {
  let now = new Date();
  return {
    subscribe(onTick: () => void) {
      const timerId = window.setInterval(() => {
        now = new Date();
        onTick();
      }, intervalMs);
      return () => window.clearInterval(timerId);
    },
    getSnapshot: () => now,
  };
}

/**
 * The current time, refreshed every `intervalMs` while the component is
 * mounted, so time-anchored UI (the calendar's now line) stays current.
 */
export function useNowTick(intervalMs: number): Date {
  const clock = useMemo(() => createTickingClock(intervalMs), [intervalMs]);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}
