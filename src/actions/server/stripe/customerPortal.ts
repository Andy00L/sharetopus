"use server";

import { eq } from "drizzle-orm";

import { authCheck } from "@/actions/server/authCheck";
import { db, runQuery } from "@/db/client";
import { users } from "@/db/schema";
import stripe from "@/lib/stripe";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "../rateLimit/checkRateLimit";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";

/**
 * success carries the portal URL in data. A failure with reason
 * "no_subscription" means the user has nothing to manage (the billing
 * buttons then offer a plan); "failed" covers everything else, with a
 * message to show.
 */
export type CustomerPortalResult =
  | { success: true; message: string; data: string }
  | {
      success: false;
      reason: "no_subscription" | "failed";
      message: string;
      resetIn?: number;
    };

/**
 * Creates a Stripe customer portal session for the authenticated user
 *
 * This function handles the entire process of creating a Stripe customer portal session:
 * 1. Performs rate limiting to prevent abuse (max 20 requests per minute)
 * 2. Verifies the user has an active subscription (active or trialing, or banked referral access)
 * 3. Retrieves the user's Stripe customer ID from the database
 * 4. Creates a Stripe customer portal session with proper return URL
 * 5. Returns the session URL for client-side redirect
 *
 * It is also the browser's only way to ask about the user's subscription:
 * checkActiveSubscription is server-only, and this action reads the user id
 * from the Clerk session.
 */
export async function createCustomerPortal(): Promise<CustomerPortalResult> {
  try {
    console.log(
      "[CreateCustomerPortal]: Starting portal session creation process"
    );
    const { userId } = await auth();

    const authResult = await authCheck(userId);
    if (!authResult || !userId) {
      console.error(
        `[CreateCustomerPortal]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        reason: "failed",
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
        reason: "failed",
        message: rateCheck.message,
        resetIn: rateCheck.resetIn,
      };
    }
    console.log("[CreateCustomerPortal]: Rate limit check passed");

    console.log(
      `[CreateCustomerPortal]: Checking subscription status for user: ${userId}`
    );
    const subscription = await checkActiveSubscription(userId);

    // Unknown is not "unsubscribed": sending a paying user to checkout
    // could start a second subscription.
    if (subscription.status === "unavailable") {
      return {
        success: false,
        reason: "failed",
        message: "Could not check your subscription. Please try again.",
      };
    }

    if (!subscription.isActive) {
      console.error(
        `[CreateCustomerPortal]: User ${userId} does not have an active subscription`
      );

      return {
        success: false,
        reason: "no_subscription",
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

    const { data: userRows, error } = await runQuery(
      db
        .select({ stripe_customer_id: users.stripe_customer_id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    );

    // A missing users row gets the same reply as a failed lookup.
    const userRow = userRows?.[0];
    if (error || !userRow) {
      console.error(
        `[CreateCustomerPortal]: Database error fetching customer_id for user ${userId}:`,
        error?.message ?? "no user row"
      );
      return {
        success: false,
        reason: "failed",
        message: "Unable to retrieve your billing information.",
      };
    }

    // Check if customer ID exists
    if (!userRow.stripe_customer_id) {
      console.error(
        `[CreateCustomerPortal]: No Stripe customer ID found for user: ${userId}`
      );
      return {
        success: false,
        reason: "failed",
        message: "Your billing profile is incomplete. Please contact support.",
      };
    }

    console.log(
      `[CreateCustomerPortal]: User ${userId} has Stripe customer ID: ${userRow.stripe_customer_id}`
    );
    const customerId = userRow.stripe_customer_id;

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
      reason: "failed",
      message:
        "An unexpected error occurred. Please try again or contact support.",
    };
  }
}
