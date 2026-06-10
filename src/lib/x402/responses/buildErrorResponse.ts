import "server-only";

import { NextResponse } from "next/server";
import type { RegisterVerifyError } from "@/lib/x402/register/handleRegisterVerify";

/**
 * Maps a RegisterVerifyError variant to a NextResponse with the appropriate
 * HTTP status code and response body.
 *
 * Body shape: { error: string, ...extraFields }
 * Follows the posts/status route convention: explicit HTTP status in the
 * NextResponse, not duplicated in the body.
 */
export function buildRegisterErrorResponse(error: RegisterVerifyError): NextResponse {
  switch (error.kind) {
    case "rate_limited":
      return NextResponse.json(
        { error: "rate_limited", retryAfter: error.retryAfterSeconds },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        }
      );

    case "malformed_payment":
    case "missing_body":
    case "malformed_body":
    case "siwe_parse_failed":
      return NextResponse.json(
        { error: error.kind, message: error.message },
        { status: 400 }
      );

    case "verify_invalid_signature":
      return NextResponse.json(
        { error: "invalid_payment_signature", message: error.message },
        { status: 400 }
      );

    case "siwe_domain_mismatch":
      return NextResponse.json(
        {
          error: "siwe_domain_mismatch",
          expected: error.expected,
          received: error.received ?? null,
        },
        { status: 401 }
      );

    case "siwe_address_mismatch":
      return NextResponse.json(
        {
          error: "siwe_address_mismatch",
          expected: error.expected,
          received: error.received ?? null,
        },
        { status: 401 }
      );

    case "siwe_chain_mismatch":
      return NextResponse.json(
        {
          error: "siwe_chain_mismatch",
          expected: error.expected,
          received: error.received ?? null,
        },
        { status: 401 }
      );

    case "siwe_nonce_invalid":
      return NextResponse.json(
        { error: "siwe_nonce_invalid", reason: error.reason },
        { status: 401 }
      );

    case "siwe_uri_mismatch":
      return NextResponse.json(
        {
          error: "siwe_uri_mismatch",
          expected: error.expected,
          received: error.received ?? null,
        },
        { status: 401 }
      );

    case "siwe_expired":
    case "siwe_not_yet_valid":
    case "siwe_invalid_signature":
      return NextResponse.json(
        { error: error.kind, message: error.message },
        { status: 401 }
      );

    case "verify_amount_mismatch":
    case "verify_network_mismatch":
    case "verify_recipient_mismatch":
      return NextResponse.json(
        { error: error.kind, message: error.message },
        { status: 402 }
      );

    case "settle_insufficient_funds":
      return NextResponse.json(
        { error: "insufficient_funds", message: error.message },
        { status: 402 }
      );

    case "verify_replay_detected":
      return NextResponse.json(
        { error: "replay", message: error.message },
        { status: 409 }
      );

    case "verify_kyt_sanctioned":
      return NextResponse.json(
        { error: "sanctioned", message: error.message },
        { status: 403 }
      );

    case "verify_facilitator_error":
    case "settle_facilitator_error":
      return NextResponse.json(
        { error: "facilitator_unavailable", message: error.message },
        { status: 502 }
      );

    case "settle_timeout":
      return NextResponse.json(
        { error: "settlement_timeout", message: error.message },
        { status: 504 }
      );

    case "settle_not_verified":
    case "db_error":
      return NextResponse.json(
        { error: "internal", message: error.message },
        { status: 500 }
      );

    case "db_insert_failed":
      // refundInitiated is only true when the on-chain refund actually
      // succeeded; a false value plus a null tx hash tells the caller the
      // settled payment needs manual reconciliation.
      return NextResponse.json(
        {
          error: "internal",
          refundInitiated: error.refundInitiated,
          refundTxHash: error.refundTxHash,
        },
        { status: 500 }
      );

    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
  }
}

/**
 * Generic error response builder for x402 paid endpoint middleware.
 *
 * Body shape: { success: false, error: errorKind, message, ...extras }
 * Supports optional refund metadata in the body.
 */
export function buildGenericErrorResponse(params: {
  httpStatus: number;
  errorKind: string;
  message: string;
  retryAfterSeconds?: number;
  refundInitiated?: boolean;
  refundTxHash?: string | null;
  chargeId?: string | null;
}): NextResponse {
  const headers: Record<string, string> = {};
  if (params.retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(params.retryAfterSeconds);
  }

  const body: Record<string, unknown> = {
    success: false,
    error: params.errorKind,
    message: params.message,
  };

  if (params.refundInitiated !== undefined) {
    body.refundInitiated = params.refundInitiated;
  }
  if (params.refundTxHash !== undefined) {
    body.refundTxHash = params.refundTxHash;
  }
  if (params.chargeId !== undefined) {
    body.chargeId = params.chargeId;
  }

  return NextResponse.json(body, { status: params.httpStatus, headers });
}
