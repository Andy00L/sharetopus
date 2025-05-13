import "server-only";
// config/uploadLimits.ts
export const PRICE_ID_UPLOAD_LIMITS: Record<
  string,
  { image: number; video: number }
> = {
  // Starter plan
  price_1RKr9JCZd1WOWtsDVHl5MsP6: { image: 250, video: 250 },
  price_1RKrGNCZd1WOWtsDcU2r7iNf: { image: 250, video: 250 },

  // Creator plan
  price_1RKrAsCZd1WOWtsDt1phjbgI: { image: 750, video: 750 },
  price_1RKrGiCZd1WOWtsDOOQ4l3wH: { image: 750, video: 750 },

  // Pro plan
  price_1RKrCRCZd1WOWtsDRzjqHluX: { image: 1500, video: 1500 },
  price_1RKrGyCZd1WOWtsD2avrk52o: { image: 1500, video: 1500 },
};
