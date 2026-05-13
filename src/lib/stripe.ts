import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  throw new Error("STRIPE_SECRET_KEY is required. Set it in .env");
}

const stripe = new Stripe(secretKey, {
  apiVersion: "2025-08-27.basil",
  typescript: true,
});

export default stripe;
