"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import stripe from "@/lib/stripe";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "../reddis/rate-limit";
import { checkUserSubscription } from "./checkUserSubscription";

export const CreateCustomerPortal = async () => {
  try {
    const hasActiveSubscription = await checkUserSubscription();

    if (!hasActiveSubscription) {
      return "error";
    }
    console.log("[CheckOutSession]: Creating stripe customer portal");
    const { userId } = await auth();

    //get the user customer_id
    const { data, error } = await adminSupabase
      .from("users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();
    console.log(
      `[CheckOutSession]: User ${userId} as a customer ID ${data?.stripe_customer_id}`
    );

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

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.FRONTEND_URL}/create`,
    });
    console.log(
      `[CheckOutSession]: Creating stripe customer portal session url ${session.url}`
    );

    return session.url;
  } catch (error) {
    console.error("Error creating checkout session", error);
    return "Failed to create checkout session";
  }
};

/*
 * Rate-limited version of CreateCustomerPortal
 * Limited to 30 requests per minute per user
 */
export async function createCustomerPortalProtected(): Promise<{
  success: boolean;
  message: string;
  data?: string;
}> {
  const { userId } = await auth();

  // Create the rate limited function with the user ID
  const rateLimitedFn = withRateLimit(
    CreateCustomerPortal,
    "customerPortal",
    userId,
    30, // 30 requests
    60 // per 60 seconds
  );

  // Simply call and return the original function's result
  return rateLimitedFn();
}
