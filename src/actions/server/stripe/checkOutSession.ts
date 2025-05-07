import stripe from "@/lib/stripe";

export const getStripeSession = async ({
  priceId,
  domainUrl,
  customerId,
}: {
  readonly priceId: string;
  readonly domainUrl: string;
  readonly customerId: string;
}) => {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    billing_address_collection: "auto",
    line_items: [{ price: priceId, quantity: 1 }],
    payment_method_types: ["card"],
    customer_update: { address: "auto", name: "auto" },
    success_url: `${domainUrl}/payement/sucess`,
    cancel_url: `${domainUrl}/payement/sucess`,
  });
  return session.url as string;
};
