import { claimTikTokWebhookEvent } from "@/actions/server/data/claimTikTokWebhookEvent";
import { inngest } from "@/inngest/client";
import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

const SIGNATURE_TOLERANCE_SECONDS = 300;

function ok(body: Record<string, unknown> = {}) {
  return NextResponse.json({ received: true, ...body }, { status: 200 });
}

function err(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getClientSecret(): string | null {
  const secret =
    process.env.NODE_ENV === "production"
      ? process.env.TIKTOK_CLIENT_SECRET
      : (process.env.TIKTOK_CLIENT_SECRET_DEV ??
        process.env.TIKTOK_CLIENT_SECRET);
  return secret ?? null;
}

type SignatureParts = { t: number; s: string };

function parseTikTokSignatureHeader(header: string): SignatureParts | null {
  const parts = header.split(",");
  let t: number | null = null;
  let s: string | null = null;

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") t = Number.parseInt(value, 10);
    else if (key === "s") s = value;
  }

  if (t === null || Number.isNaN(t) || !s) return null;
  return { t, s };
}

function verifyTikTokSignature(input: {
  rawBody: string;
  header: string;
  secret: string;
}): { valid: true } | { valid: false; reason: string } {
  const parsed = parseTikTokSignatureHeader(input.header);
  if (!parsed) {
    return { valid: false, reason: "Malformed signature header" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parsed.t) > SIGNATURE_TOLERANCE_SECONDS) {
    return {
      valid: false,
      reason: `Timestamp outside tolerance (delta=${nowSec - parsed.t}s)`,
    };
  }

  const signedPayload = `${parsed.t}.${input.rawBody}`;
  const expected = createHmac("sha256", input.secret)
    .update(signedPayload)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parsed.s, "hex");
  if (a.length !== b.length) {
    return { valid: false, reason: "Signature length mismatch" };
  }

  if (!timingSafeEqual(a, b)) {
    return { valid: false, reason: "Signature mismatch" };
  }

  return { valid: true };
}

type TikTokWebhookPayload = {
  client_key: string;
  event: string;
  create_time: number;
  user_openid: string;
  content: string;
};

function computeEventId(payload: TikTokWebhookPayload): string {
  return createHash("sha256")
    .update(
      `${payload.client_key}.${payload.create_time}.${payload.event}.${payload.content}`,
    )
    .digest("hex");
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sigHeader = req.headers.get("tiktok-signature");

  if (!sigHeader) {
    console.error("[TikTok webhook] Missing TikTok-Signature header");
    return err("Missing signature", 400);
  }

  const secret = getClientSecret();
  if (!secret) {
    console.error("[TikTok webhook] TIKTOK_CLIENT_SECRET not configured");
    return err("Webhook misconfigured", 500);
  }

  const sigCheck = verifyTikTokSignature({
    rawBody,
    header: sigHeader,
    secret,
  });

  if (!sigCheck.valid) {
    console.error(
      `[TikTok webhook] Signature verification failed: ${sigCheck.reason}`,
    );
    return err("Invalid signature", 400);
  }

  let payload: TikTokWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as TikTokWebhookPayload;
  } catch (parseErr) {
    console.error(
      "[TikTok webhook] Body JSON parse failed:",
      parseErr instanceof Error ? parseErr.message : parseErr,
    );
    return err("Invalid JSON body", 400);
  }

  if (!payload.event || !payload.client_key || !payload.create_time) {
    console.error("[TikTok webhook] Payload missing required fields");
    return err("Malformed payload", 400);
  }

  const eventId = computeEventId(payload);

  const claim = await claimTikTokWebhookEvent({
    event_id: eventId,
    event_type: payload.event,
  });

  if (!claim.claimed && claim.reason === "duplicate") {
    console.log(
      `[TikTok webhook] Duplicate event ${eventId} (${payload.event}), returning 200`,
    );
    return ok({ duplicate: true, event_id: eventId });
  }

  if (!claim.claimed && claim.reason === "error") {
    // DB transient error. Return 500 so TikTok retries.
    return err(claim.message, 500);
  }

  // Dispatch to Inngest for async processing. Return 200 immediately so
  // TikTok stops retrying. The Inngest worker handles failures with its
  // own retry policy.
  try {
    await inngest.send({
      name: "tiktok.publish.webhook.received",
      data: {
        event_id: eventId,
        client_key: payload.client_key,
        event: payload.event,
        create_time: payload.create_time,
        user_openid: payload.user_openid,
        content: payload.content,
      },
    });
  } catch (dispatchErr) {
    console.error(
      "[TikTok webhook] Inngest dispatch failed:",
      dispatchErr instanceof Error ? dispatchErr.message : dispatchErr,
    );
    // Claim is already inserted. Returning 500 would cause TikTok retry
    // but the duplicate claim would reject it. Better to log and
    // return 200; the post can be re-finalized by polling safety net.
    return ok({ dispatched: false, event_id: eventId });
  }

  console.log(
    `[TikTok webhook] Dispatched ${payload.event} for event_id=${eventId}`,
  );
  return ok({ dispatched: true, event_id: eventId });
}
