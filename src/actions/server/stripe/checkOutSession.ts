"use server";

import { eq } from "drizzle-orm";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { authCheck } from "@/actions/server/authCheck";
import { db, runQuery } from "@/db/client";
import { users } from "@/db/schema";
import stripe from "@/lib/stripe";
import { priceIdToTier } from "@/lib/types/plans";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

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

    // A server action takes any string from the browser: only the plan
    // prices the app sells may open a checkout.
    if (!priceId || priceIdToTier(priceId) === null) {
      console.error(`[checkOutSession]: Unknown or missing price ID: ${priceId}`);
      return {
        success: false,
        message: "Subscription plan not specified. Please select a valid plan.",
      };
    }

    const { userId } = await auth();

    const authResult = await authCheck(userId);
    if (!authResult || !userId) {
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
      "stripeCheckOutSession",
      userId,
      15,
      60
    );
    if (!rateCheck.success) {
      console.warn(
        `[checkOutSession]: Rate limit exceeded for user: ${userId}. Reset in: ${
          rateCheck.resetIn ?? "unknown"
        } seconds`
      );
      return {
        success: false,
        message: rateCheck.message,
        resetIn: rateCheck.resetIn,
      };
    }
    console.log("[checkOutSession]: Rate limit check passed");

    // A second checkout would start a second subscription: a subscriber
    // changes plans in the billing portal. Banked referral weeks are not a
    // Stripe subscription, so those users may still buy one.
    const subscription = await checkActiveSubscription(userId);
    if (subscription.status === "unavailable") {
      return {
        success: false,
        message: "Could not check your subscription. Please try again.",
      };
    }
    if (subscription.status === "active" || subscription.status === "trialing") {
      console.warn(
        `[checkOutSession]: User ${userId} already has a ${subscription.status} subscription`
      );
      return {
        success: false,
        message:
          "You already have an active subscription. Manage it from the billing portal.",
      };
    }

    console.log(
      `[checkOutSession]: Fetching Stripe customer ID for user: ${userId}`
    );
    const { data: userRows, error } = await runQuery(
      db
        .select({ stripe_customer_id: users.stripe_customer_id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    );

    const userRow = userRows?.[0];
    if (error || !userRow) {
      console.error(
        `[checkOutSession]: Database error fetching customer_id for user ${userId}:`,
        error?.message ?? "no user row"
      );
      return {
        success: false,
        message: "Unable to retrieve your customer information .",
      };
    }

    if (!userRow.stripe_customer_id) {
      console.error(
        `[checkOutSession]: No Stripe customer ID found for user: ${userId}`
      );
      return {
        success: false,
        message: "Your customer profile is incomplete. Please contact support.",
      };
    }

    console.log(
      `[checkOutSession]: User ${userId} has Stripe customer ID: ${userRow.stripe_customer_id}`
    );
    const customerId = userRow.stripe_customer_id;

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
