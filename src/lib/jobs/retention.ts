// tiktok_webhook_events deduplicates redeliveries, so this must outlast
// TikTok's 72-hour redelivery window:
// https://developers.tiktok.com/doc/webhooks-overview
export const RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionCutoff {
  cutoffIso: string;
  cutoffMonth: string;
}

export function computeRetentionCutoff(now: Date): RetentionCutoff {
  const cutoffIso = new Date(now.getTime() - RETENTION_DAYS * DAY_MS).toISOString();
  return { cutoffIso, cutoffMonth: `${cutoffIso.slice(0, 7)}-01` };
}
