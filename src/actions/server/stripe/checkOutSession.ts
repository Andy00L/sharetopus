"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/authCheck";
import stripe from "@/lib/stripe";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "../reddis/rate-limit";

/**
 * Creates a Stripe checkout session for subscription purchase
 *
 * This function handles the entire process of creating a checkout session:
 * 1. Verifies user authentication
 * 2. Performs rate limiting to prevent abuse (max 15 requests per minute)
 * 3. Retrieves the user's Stripe customer ID from the database
 * 4. Creates a Stripe checkout session for the selected price/plan
 * 5. Returns the session URL for client-side redirect
 *
 * @param {object} params - The function parameters
 * @param {string} params.priceId - The Stripe price ID for the subscription plan
 * @returns {Promise<{success: boolean; message: string; data?: string; resetIn?: number}>}
 *   Success response contains the checkout URL in the data field
 *   Error response includes descriptive message and optional resetIn time for rate limits
 */
export async function checkOutSession(priceId: string): Promise<{
  success: boolean;
  message: string;
  data?: string;
  resetIn?: number;
}> {
  try {
    console.log(
      "[checkOutSession]: Starting checkout session creation process"
    );

    // Validate price ID input
    if (!priceId) {
      console.error("[checkOutSession]: Missing required price ID");
      return {
        success: false,
        message: "Subscription plan not specified. Please select a valid plan.",
      };
    }

    const { userId } = await auth();

    // Verify user is properly authenticated
    const authResult = await authCheck(userId);
    if (!authResult) {
      console.error(
        `[checkOutSession]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }
    console.log(
      `[checkOutSession]: Authentication validated for user: ${userId}`
    );

    console.log(`[checkOutSession]: Checking rate limits for user: ${userId}`);
    const rateCheck = await checkRateLimit(
      "stripeCheckOutSession", // Unique identifier for this operation
      userId, // User identifier
      15, // Limit (15 requests)
      60 // Window (60 seconds)
    );
    if (!rateCheck.success) {
      console.warn(
        `[checkOutSession]: Rate limit exceeded for user: ${userId}. Reset in: ${
          rateCheck.resetIn ?? "unknown"
        } seconds`
      );
      return {
        success: false,
        message: "Too many checkout attempts. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }
    console.log("[checkOutSession]: Rate limit check passed");

    // Step 3: Retrieve the user's Stripe customer ID from the database
    console.log(
      `[checkOutSession]: Fetching Stripe customer ID for user: ${userId}`
    );
    const { data, error } = await adminSupabase
      .from("users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    if (error) {
      console.error(
        `[checkOutSession]: Database error fetching customer_id for user ${userId}:`,
        error.message,
        error.details
      );
      return {
        success: false,
        message: "Unable to retrieve your customer information .",
      };
    }

    // Check if customer ID exists
    if (!data?.stripe_customer_id) {
      console.error(
        `[checkOutSession]: No Stripe customer ID found for user: ${userId}`
      );
      return {
        success: false,
        message: "Your customer profile is incomplete. Please contact support.",
      };
    }

    console.log(
      `[checkOutSession]: User ${userId} has Stripe customer ID: ${data.stripe_customer_id}`
    );
    const customerId = data.stripe_customer_id;

    // Step 4: Create the Stripe checkout session
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

    // Add this validation block
    if (!session || !session.url) {
      console.error(
        `[checkOutSession]: Stripe returned invalid session object: ${JSON.stringify(
          session
        )}`
      );
      return {
        success: false,
        message: "Failed to create a valid checkout session. Please try again.",
      };
    }
    console.log(
      `[checkOutSession]: Successfully created checkout session URL: ${session.url}`
    );

    // Return success with the checkout URL
    return {
      success: true,
      message: "Checkout session created successfully",
      data: session.url,
    };
  } catch (error) {
    console.error(
      "[checkOutSession]: Unexpected error creating checkout session:",
      error instanceof Error ? error.message : error
    );
    return {
      success: false,
      message:
        "An unexpected error occurred. Please try again or contact support.",
    };
  }
}
