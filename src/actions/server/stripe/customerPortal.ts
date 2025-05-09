"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import stripe from "@/lib/stripe";
import { auth } from "@clerk/nextjs/server";

export const CreateCustomerPortal = async () => {
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

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.FRONTEND_URL}/create`,
    });

    return session.url;
  } catch (error) {
    console.error("Error creating checkout session", error);
    return "Failed to create checkout session";
  }
};
