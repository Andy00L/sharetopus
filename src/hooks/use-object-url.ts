"use client";

import { useMemo, useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};

const readNoObjectUrl = () => null;

export function createObjectUrlStore(blob: Blob) {
  let objectUrl: string | null = null;
  return {
    subscribe(onObjectUrlChange: () => void) {
      const createdUrl = URL.createObjectURL(blob);
      objectUrl = createdUrl;
      onObjectUrlChange();
      return () => {
        URL.revokeObjectURL(createdUrl);
        objectUrl = null;
      };
    },
    getSnapshot: () => objectUrl,
  };
}

export function useObjectUrl(blob: Blob | null): string | null {
  const store = useMemo(() => (blob ? createObjectUrlStore(blob) : null), [blob]);
  return useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    store?.getSnapshot ?? readNoObjectUrl,
    readNoObjectUrl,
  );
}
