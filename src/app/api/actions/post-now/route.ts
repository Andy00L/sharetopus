import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  buildActionHeaders,
  buildActionsPreflightResponse,
} from "@/lib/solanaActions/headers";
import {
  describePostNowAction,
  parseBlinkTarget,
  parseBlinkText,
  preparePostNowPayment,
} from "@/lib/solanaActions/postNowBlink";

/**
 * Solana Action for post-now (the Blink).
 *
 * GET  ?account_id&platform          the action card (price, one text field)
 * POST ?account_id&platform&text     {account} -> unsigned USDC payment
 *
 * Blink URL: https://dial.to/?action=solana-action:<this URL with the query>
 * Logic lives in src/lib/solanaActions/postNowBlink.ts; this file only maps
 * HTTP to it. Every response carries the Actions CORS and version headers.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const targetResult = parseBlinkTarget(req.nextUrl.searchParams);
  if (!targetResult.ok) {
    return NextResponse.json(
      { message: targetResult.message },
      { status: targetResult.httpStatus, headers: buildActionHeaders() },
    );
  }
  const card = await describePostNowAction(targetResult.target);
  return NextResponse.json(card, { headers: buildActionHeaders() });
}

export async function POST(req: NextRequest) {
  const targetResult = parseBlinkTarget(req.nextUrl.searchParams);
  if (!targetResult.ok) {
    return NextResponse.json(
      { message: targetResult.message },
      { status: targetResult.httpStatus, headers: buildActionHeaders() },
    );
  }
  const textResult = parseBlinkText(req.nextUrl.searchParams);
  if (!textResult.ok) {
    return NextResponse.json(
      { message: textResult.message },
      { status: textResult.httpStatus, headers: buildActionHeaders() },
    );
  }

  const bodyResult = await readAccountFromBody(req);
  if (!bodyResult.ok) {
    return NextResponse.json(
      { message: bodyResult.message },
      { status: 400, headers: buildActionHeaders() },
    );
  }

  const prepared = await preparePostNowPayment({
    target: targetResult.target,
    text: textResult.text,
    payerAddressRaw: bodyResult.account,
  });
  if (!prepared.ok) {
    return NextResponse.json(
      { message: prepared.message },
      { status: prepared.httpStatus, headers: buildActionHeaders() },
    );
  }

  // TransactionResponse with a post-chain link, per @solana/actions-spec v2.4.2.
  return NextResponse.json(
    {
      type: "transaction",
      transaction: prepared.transactionBase64,
      message: prepared.message,
      links: { next: { type: "post", href: prepared.confirmHref } },
    },
    { headers: buildActionHeaders() },
  );
}

export function OPTIONS() {
  return buildActionsPreflightResponse();
}

/** The spec's ActionPostRequest carries the signer as `account`. */
async function readAccountFromBody(
  req: NextRequest,
): Promise<{ ok: true; account: string } | { ok: false; message: string }> {
  try {
    const body: unknown = await req.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "account" in body &&
      typeof body.account === "string" &&
      body.account.length > 0
    ) {
      return { ok: true, account: body.account };
    }
    return { ok: false, message: "Request body must include the signer account." };
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
}
