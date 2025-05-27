import "server-only";
// config/uploadLimits.ts
export const PRICE_ID_UPLOAD_LIMITS: Record<
  string,
  { image: number; video: number }
> = {
  // Starter plan
  price_1RNMXJCyG8V2WH2FUpSI7VJt: { image: 250, video: 250 },
  price_1RNMXJCyG8V2WH2FLLApU9iL: { image: 250, video: 250 },

  // Creator plan
  price_1RNMXHCyG8V2WH2Fq3TC2YwY: { image: 250, video: 250 },
  price_1RNMXHCyG8V2WH2FJJWCcCk4: { image: 250, video: 250 },

  // Pro plan
  price_1RNMXECyG8V2WH2FxDDhYNy8: { image: 250, video: 250 },
  price_1RNMXDCyG8V2WH2Fz1ae60z4: { image: 250, video: 250 },
};
