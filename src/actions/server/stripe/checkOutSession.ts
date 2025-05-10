"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import stripe from "@/lib/stripe";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "../reddis/rate-limit";

export const getStripeSession = async ({
  priceId,
}: {
  readonly priceId: string;
}) => {
  try {
    const { userId } = await auth();

    //get the user customer_id
    const { data, error } = await adminSupabase
      .from("users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    if (error) {
      console.error(
        "[CheckOutSession]: Supabase error fetching customer_id:",
        error
      );
      throw new Error(
        "[CheckOutSession]:  Supabase error fetching customer_id"
      );
    }

    const customerId = data.stripe_customer_id;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      billing_address_collection: "auto",
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_types: ["card"],
      customer_update: { address: "auto", name: "auto" },
      success_url: `${process.env.FRONTEND_URL}/payment/success`,
      cancel_url: `${process.env.FRONTEND_URL}`,
      allow_promotion_codes: true,
    });

    return session.url;
  } catch (error) {
    console.error("Error creating checkout session", error);
    return "Failed to create checkout session";
  }
};

/**
 * Rate-limited version of getStripeSession
 * Limited to 5 requests per minute per user
 */
export async function getStripeSessionProtected({
  priceId,
}: {
  readonly priceId: string;
}): Promise<{
  success: boolean;
  message: string;
  data?: string | null;
}> {
  const { userId } = await auth();

  // Create the rate limited function with the user ID
  const rateLimitedFn = withRateLimit(
    getStripeSession,
    "stripeCheckout",
    userId,
    5, // 5 requests
    60 // per 60 seconds
  );

  // Call the rate limited function with the price ID
  return rateLimitedFn({ priceId });
}
