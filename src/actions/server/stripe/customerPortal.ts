"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/server/authCheck";
import stripe from "@/lib/stripe";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "../rateLimit/checkRateLimit";
import { checkUserSubscription } from "./checkUserSubscription";

/**
 * Creates a Stripe customer portal session for the authenticated user
 *
 * This function handles the entire process of creating a Stripe customer portal session:
 * 1. Performs rate limiting to prevent abuse (max 20 requests per minute)
 * 2. Verifies the user has an active subscription (active, trialing, or past_due)
 * 3. Retrieves the user's Stripe customer ID from the database
 * 4. Creates a Stripe customer portal session with proper return URL
 * 5. Returns the session URL for client-side redirect
 *
 * @returns {Promise<{success: boolean; message: string; data?: string; resetIn?: number}>}
 *   Success response contains the portal URL in the data field
 *   Error response includes descriptive message and optional resetIn time for rate limits
 */
export async function createCustomerPortal(): Promise<{
  success: boolean;
  message: string;
  data?: string;
  resetIn?: number;
}> {
  try {
    console.log(
      "[CreateCustomerPortal]: Starting portal session creation process"
    );
    const { userId } = await auth();

    const authResult = await authCheck(userId);
    if (!authResult) {
      console.error(
        `[CreateCustomerPortal]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }

    console.log(
      `[CreateCustomerPortal]: Checking rate limits for user: ${userId}`
    );
    const rateCheck = await checkRateLimit(
      "createCustomerPortal", // Unique identifier for this operation
      userId, // User identifier
      20, // Limit (requests)
      60 // Window (seconds)
    );
    if (!rateCheck.success) {
      console.warn(
        `[CreateCustomerPortal]: Rate limit exceeded for user: ${userId}. Reset in: ${
          rateCheck.resetIn ?? "unknown"
        } seconds`
      );
      return {
        success: false,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }
    console.log("[CreateCustomerPortal]: Rate limit check passed");

    console.log(
      `[CreateCustomerPortal]: Checking subscription status for user: ${userId}`
    );
    const hasActiveSubscription = await checkUserSubscription(userId);

    if (!hasActiveSubscription) {
      console.error(
        `[CreateCustomerPortal]: User ${userId} does not have an active subscription`
      );

      return {
        success: false,
        message: "No active subscription found. Please subscribe first.",
      };
    }

    console.log(
      `[CreateCustomerPortal]: Verified active subscription for user: ${userId}`
    );

    // Retrieve the user's Stripe customer ID from the database
    console.log(
      `[CreateCustomerPortal]: Fetching Stripe customer ID for user: ${userId}`
    );

    const { data, error } = await adminSupabase
      .from("users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    if (error) {
      console.error(
        `[CreateCustomerPortal]: Database error fetching customer_id for user ${userId}:`,
        error.message,
        error.details
      );
      return {
        success: false,
        message: "Unable to retrieve your billing information .",
      };
    }

    // Check if customer ID exists
    if (!data?.stripe_customer_id) {
      console.error(
        `[CreateCustomerPortal]: No Stripe customer ID found for user: ${userId}`
      );
      return {
        success: false,
        message: "Your billing profile is incomplete. Please contact support.",
      };
    }

    console.log(
      `[CreateCustomerPortal]: User ${userId} has Stripe customer ID: ${data.stripe_customer_id}`
    );
    const customerId = data.stripe_customer_id;

    console.log(
      `[CreateCustomerPortal]: Creating Stripe portal session for customer: ${customerId}`
    );
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.FRONTEND_URL}/create`,
    });
    console.log(
      `[CreateCustomerPortal]: Successfully created portal session URL: ${session.url}`
    );

    return {
      success: true,
      message: "Portal session created successfully",
      data: session.url,
    };
  } catch (error) {
    console.error(
      "[CreateCustomerPortal]: Unexpected error creating portal session:",
      error instanceof Error ? error.message : error
    );
    return {
      success: false,
      message:
        "An unexpected error occurred. Please try again or contact support.",
    };
  }
}
