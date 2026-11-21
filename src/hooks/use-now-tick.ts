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

export function useNowTick(intervalMs: number): Date {
  const clock = useMemo(() => createTickingClock(intervalMs), [intervalMs]);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}
