import "server-only";

// Just check the environment
const isProd = process.env.NODE_ENV === "production";

// Production upload limits
const PROD_PRICE_ID_UPLOAD_LIMITS: Record<
  string,
  { image: number; video: number }
> = {
  // Starter plan
  price_1RNMXJCyG8V2WH2FUpSI7VJt: { image: 8, video: 250 }, // Monthly
  price_1RNMXJCyG8V2WH2FLLApU9iL: { image: 8, video: 250 }, // Yearly

  // Creator plan
  price_1RNMXHCyG8V2WH2Fq3TC2YwY: { image: 8, video: 250 }, // Monthly
  price_1RNMXHCyG8V2WH2FJJWCcCk4: { image: 8, video: 250 }, // Yearly

  // Pro plan
  price_1RNMXECyG8V2WH2FxDDhYNy8: { image: 8, video: 250 }, // Monthly
  price_1RNMXDCyG8V2WH2Fz1ae60z4: { image: 8, video: 250 }, // Yearly
};

// Development upload limits
const DEV_PRICE_ID_UPLOAD_LIMITS: Record<
  string,
  { image: number; video: number }
> = {
  // Dev Starter plan
  price_1RKr9JCZd1WOWtsDVHl5MsP6: { image: 8, video: 250 }, // Monthly
  price_1RKrGNCZd1WOWtsDcU2r7iNf: { image: 8, video: 250 }, // Yearly

  // Dev Creator plan
  price_1RKrAsCZd1WOWtsDt1phjbgI: { image: 8, video: 250 }, // Monthly
  price_1RKrGiCZd1WOWtsDOOQ4l3wH: { image: 8, video: 250 }, // Yearly

  // Dev Pro plan
  price_1RKrCRCZd1WOWtsDRzjqHluX: { image: 8, video: 250 }, // Monthly
  price_1RKrGyCZd1WOWtsD2avrk52o: { image: 8, video: 250 }, // Yearly
};

// Export the right upload limits based on environment
export const PRICE_ID_UPLOAD_LIMITS: Record<
  string,
  { image: number; video: number }
> = isProd ? PROD_PRICE_ID_UPLOAD_LIMITS : DEV_PRICE_ID_UPLOAD_LIMITS;

// Default upload limits for unknown subscription IDs
export const DEFAULT_UPLOAD_LIMITS = { image: 8, video: 250 };
