import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  buildActionHeaders,
  buildActionsPreflightResponse,
} from "@/lib/solanaActions/headers";
import {
  confirmPostNowPayment,
  parseBlinkTarget,
  parseBlinkText,
} from "@/lib/solanaActions/postNowBlink";
import { getBaseUrl } from "@/lib/x402/config";

/**
 * Second link in the post-now Blink chain. The client calls it after the
 * wallet broadcast the payment, with the signature. On success it returns
 * the spec's completed action carrying the explorer link; on failure an
 * ActionError with the reason (and the refund signature when one was sent).
 *
 * Logic lives in src/lib/solanaActions/postNowBlink.ts.
 */

export const runtime = "nodejs";
// Confirmation polling can take up to 15s; the post dispatch is quick.
export const maxDuration = 60;

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

  const bodyResult = await readConfirmBody(req);
  if (!bodyResult.ok) {
    return NextResponse.json(
      { message: bodyResult.message },
      { status: 400, headers: buildActionHeaders() },
    );
  }

  const confirmed = await confirmPostNowPayment({
    target: targetResult.target,
    text: textResult.text,
    payerAddressRaw: bodyResult.account,
    txSignatureRaw: bodyResult.signature,
  });
  if (!confirmed.ok) {
    return NextResponse.json(
      {
        message: confirmed.message,
        ...(confirmed.refundTxHash ? { refundTxHash: confirmed.refundTxHash } : {}),
      },
      { status: confirmed.httpStatus, headers: buildActionHeaders() },
    );
  }

  // CompletedAction per @solana/actions-spec v2.4.2.
  return NextResponse.json(
    {
      type: "completed",
      icon: `${getBaseUrl()}/logo.png`,
      title: "Posted",
      description: `Paid on Solana and dispatched to ${targetResult.target.platform}. Signature ${confirmed.txSignature}. Explorer: ${confirmed.explorerUrl}`,
      label: "Done",
    },
    { headers: buildActionHeaders() },
  );
}

export function OPTIONS() {
  return buildActionsPreflightResponse();
}

/** NextActionPostRequest: the signer account plus the broadcast signature. */
async function readConfirmBody(
  req: NextRequest,
): Promise<
  { ok: true; account: string; signature: string } | { ok: false; message: string }
> {
  try {
    const body: unknown = await req.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "account" in body &&
      typeof body.account === "string" &&
      body.account.length > 0 &&
      "signature" in body &&
      typeof body.signature === "string" &&
      body.signature.length > 0
    ) {
      return { ok: true, account: body.account, signature: body.signature };
    }
    return { ok: false, message: "Request body must include account and signature." };
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
}
