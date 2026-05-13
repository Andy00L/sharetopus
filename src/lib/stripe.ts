import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  throw new Error("STRIPE_SECRET_KEY is required. Set it in .env");
}

if (process.env.NODE_ENV === "production") {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required in production");
  }
} else if (!process.env.STRIPE_WEBHOOK_SECRET_DEV) {
  console.warn(
    "[stripe] STRIPE_WEBHOOK_SECRET_DEV not set. Webhook signature verification will fail in dev.",
  );
}

const stripe = new Stripe(secretKey, {
  apiVersion: "2025-08-27.basil",
  typescript: true,
});

export default stripe;
