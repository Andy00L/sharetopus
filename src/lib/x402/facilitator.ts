import "server-only";

/**
 * Thin wrapper around the Coinbase CDP facilitator for the x402 payment
 * protocol. Three operations: verify a payment header, settle a verified
 * payment, and refund a settled payment. Each returns an errors-as-values
 * result.
 *
 * Called by: x402PaidEndpoint, register/connect verify flows
 * Tables touched: none (the facilitator is external; DB writes happen in the
 * flow handlers)
 * Env: CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET (CDP SDK),
 *      X402_RECIPIENT_EVM (EVM refund sender); facilitator URL via config.ts
 *
 * SDK notes (verified against @x402/core v2.14.0):
 *   - Network is CAIP format ("eip155:8453") in the SDK, not WalletChain
 *     ("base"). NetworkConfig.caipNetwork bridges the two (networks.ts).
 *   - VerifyResponse is { isValid, invalidReason?, invalidMessage?, payer? };
 *     this wrapper maps invalidReason strings to typed error kinds.
 *   - SettleResponse is { success, transaction, network, errorReason?, ... }.
 *     It carries no blockNumber or facilitator fee; those fields are null in
 *     the wrapper result.
 *   - The CDP hosted facilitator requires CDP API-key JWTs on verify/settle;
 *     the singleton client wiring lives in facilitatorClient.ts (shared with
 *     solana/feePayer.ts).
 *   - Refunds go through the CDP SDK directly (merchant -> agent); the
 *     facilitator only handles agent -> merchant.
 */

import { CdpClient } from "@coinbase/cdp-sdk";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { NetworkConfig } from "@/lib/x402/networks";
import { getRecipientAddress } from "@/lib/x402/config";
import { getFacilitatorClient } from "@/lib/x402/facilitatorClient";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";
import { buildPaymentRequirements } from "@/lib/x402/http/paymentHttp";
import {
  extractNonceFromPayload,
  fallbackNonceFromHeader,
} from "@/lib/x402/payment/paymentPayload";

// ---------------------------------------------------------------------------
// CDP Client singleton
// ---------------------------------------------------------------------------

let cdpClientInstance: CdpClient | null = null;

/**
 * Lazy singleton CDP client. Reads CDP_API_KEY_ID, CDP_API_KEY_SECRET,
 * CDP_WALLET_SECRET from env automatically. Throws on first access if any
 * of the three env vars is missing; every caller invokes it inside a
 * try/catch that converts the throw into an errors-as-values result, so the
 * throw is a documented fail-fast on misconfiguration, not control flow.
 */
export function getCdpClient(): CdpClient {
  if (cdpClientInstance) return cdpClientInstance;

  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  const walletSecret = process.env.CDP_WALLET_SECRET;

  if (!apiKeyId || !apiKeySecret || !walletSecret) {
    const missing = [
      !apiKeyId && "CDP_API_KEY_ID",
      !apiKeySecret && "CDP_API_KEY_SECRET",
      !walletSecret && "CDP_WALLET_SECRET",
    ].filter(Boolean);
    throw new Error(
      `[getCdpClient] Missing required env var(s): ${missing.join(", ")}. ` +
        "Set them in .env.local or Vercel environment settings."
    );
  }

  cdpClientInstance = new CdpClient();
  return cdpClientInstance;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export interface VerifyPaymentInput {
  /** Raw payment header value (PAYMENT-SIGNATURE, or X-PAYMENT from v1 clients). */
  paymentHeader: string;

  /** Resource URL the agent is paying to access. */
  resourceUrl: string;

  /** Expected payment amount in USDC units (human, not atomic). */
  amountUsdc: number;

  /** Recipient address (Server Wallet) on this network. */
  recipientAddress: string;

  /** Network the agent claims to be paying on. */
  network: NetworkConfig;
}

export type VerifyPaymentResult =
  | { ok: true; payerAddress: string; nonce: string; chargeAmountUsdc: number }
  | { ok: false; error: VerifyPaymentError };

export type VerifyPaymentError =
  | { kind: "malformed_header"; message: string }
  | { kind: "invalid_signature"; message: string }
  | { kind: "amount_mismatch"; expected: number; received: number }
  | { kind: "network_mismatch"; expected: string; received: string }
  | { kind: "recipient_mismatch"; expected: string; received: string }
  | { kind: "replay_detected"; nonce: string }
  | { kind: "facilitator_error"; message: string }
  | { kind: "kyt_sanctioned"; payerAddress: string };

/**
 * Verifies a payment header against the facilitator. Does NOT settle yet.
 * The facilitator runs KYT (sanctions screening) as part of verify;
 * sanctioned payers are rejected here, before any DB write.
 *
 * On success the result carries the payer address recovered by the
 * facilitator (not the unverified claim inside the payload) and a replay
 * nonce: the scheme nonce when the payload has one, otherwise a SHA-256 of
 * the payment header (see payment/paymentPayload.ts).
 */
export async function verifyPayment(
  input: VerifyPaymentInput
): Promise<VerifyPaymentResult> {
  // 1. Decode the payment header
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(input.paymentHeader);
  } catch (err) {
    console.error("[verifyPayment] Failed to decode payment header:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "malformed_header",
        message: "Payment header is not valid base64-encoded JSON.",
      },
    };
  }

  // 2. Build expected requirements from the route configuration. On Solana
  //    this resolves the facilitator fee payer (extra.feePayer), which the
  //    facilitator's verify requires; without it the payment cannot be
  //    verified, so the failure maps to facilitator_error (502 everywhere).
  const requirementsResult = await buildPaymentRequirements({
    network: input.network,
    amountUsdc: input.amountUsdc,
    recipientAddress: input.recipientAddress,
  });
  if (!requirementsResult.ok) {
    return {
      ok: false,
      error: { kind: "facilitator_error", message: requirementsResult.message },
    };
  }
  const requirements: PaymentRequirements = requirementsResult.requirements;

  // 3. Pre-verify checks: network and recipient mismatch
  const payloadNetwork = paymentPayload.accepted?.network;
  if (payloadNetwork && payloadNetwork !== requirements.network) {
    return {
      ok: false,
      error: {
        kind: "network_mismatch",
        expected: requirements.network,
        received: payloadNetwork,
      },
    };
  }

  const payloadPayTo = paymentPayload.accepted?.payTo;
  if (
    payloadPayTo &&
    payloadPayTo.toLowerCase() !== requirements.payTo.toLowerCase()
  ) {
    return {
      ok: false,
      error: {
        kind: "recipient_mismatch",
        expected: requirements.payTo,
        received: payloadPayTo,
      },
    };
  }

  // 4. Call the facilitator
  try {
    const facilitator = getFacilitatorClient();
    const response = await facilitator.verify(paymentPayload, requirements);

    if (response.isValid) {
      // The payer recovered by the facilitator is the address money actually
      // moves from; downstream wallet resolution and refunds depend on it,
      // so a missing payer is a malformed facilitator response, not "unknown".
      const payerAddress = response.payer;
      if (!payerAddress) {
        console.error("[verifyPayment] Facilitator verify succeeded but returned no payer address.");
        return {
          ok: false,
          error: {
            kind: "facilitator_error",
            message: "Facilitator verify response is missing the payer address.",
          },
        };
      }

      const nonce =
        extractNonceFromPayload(paymentPayload) ??
        fallbackNonceFromHeader(input.paymentHeader);

      return {
        ok: true,
        payerAddress,
        nonce,
        chargeAmountUsdc: input.amountUsdc,
      };
    }

    // Map invalidReason to typed error
    return {
      ok: false,
      error: mapVerifyInvalidReason(
        response.invalidReason,
        response.invalidMessage,
        response.payer,
        input,
        paymentPayload
      ),
    };
  } catch (err) {
    console.error("[verifyPayment] Facilitator verify threw:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "facilitator_error",
        message: err instanceof Error ? err.message : "Unknown facilitator error during verify.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Settle
// ---------------------------------------------------------------------------

export interface SettlePaymentInput {
  /** The verified payment header (same one passed to verifyPayment). */
  paymentHeader: string;

  /** The network the payment is on. */
  network: NetworkConfig;
}

export type SettlePaymentResult =
  | {
      ok: true;
      txHash: string;
      blockNumber: number | null;
      facilitatorFeeUsdc: number | null;
      settledAt: string;
    }
  | { ok: false; error: SettlePaymentError };

export type SettlePaymentError =
  | { kind: "not_verified"; message: string }
  | { kind: "insufficient_funds"; message: string }
  | { kind: "facilitator_error"; message: string }
  | { kind: "timeout"; message: string };

/**
 * Settles a previously verified payment on-chain. The facilitator submits
 * the transaction and waits for confirmation.
 *
 * Settlement reuses the requirements the client accepted (embedded in the
 * payload); a payload without them cannot be settled safely, so that case
 * fails closed instead of fabricating requirements.
 *
 * blockNumber and facilitatorFeeUsdc are not available from the @x402/core
 * SettleResponse; they are null here and may be enriched from transaction
 * receipts later.
 */
export async function settlePayment(
  input: SettlePaymentInput
): Promise<SettlePaymentResult> {
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(input.paymentHeader);
  } catch (err) {
    console.error("[settlePayment] Failed to decode header for settle:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "facilitator_error",
        message: "Failed to decode payment header for settlement.",
      },
    };
  }

  const acceptedRequirements = paymentPayload.accepted;
  if (!acceptedRequirements) {
    return {
      ok: false,
      error: {
        kind: "facilitator_error",
        message:
          "Payment payload carries no accepted requirements; cannot settle.",
      },
    };
  }

  try {
    const facilitator = getFacilitatorClient();
    const response = await facilitator.settle(
      paymentPayload,
      acceptedRequirements
    );

    if (response.success) {
      return {
        ok: true,
        txHash: response.transaction,
        blockNumber: null, // Not available from @x402/core SettleResponse
        facilitatorFeeUsdc: null, // Not available from @x402/core SettleResponse
        settledAt: new Date().toISOString(),
      };
    }

    return {
      ok: false,
      error: mapSettleErrorReason(response.errorReason, response.errorMessage),
    };
  } catch (err) {
    console.error("[settlePayment] Facilitator settle threw:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "facilitator_error",
        message: err instanceof Error ? err.message : "Unknown facilitator error during settle.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

export interface RefundPaymentInput {
  /** The original settled charge's tx_hash. */
  originalTxHash: string;

  /** Payer's wallet address (refund destination). */
  payerAddress: string;

  /** Amount to refund in USDC units. Must be > 0 and <= original charge amount. */
  amountUsdc: number;

  /** Network the original charge was on. */
  network: NetworkConfig;

  /** Reason for refund. Logged for observability. */
  reason: string;
}

export type RefundPaymentResult =
  | { ok: true; refundTxHash: string; refundedAt: string }
  | { ok: false; error: RefundPaymentError };

export type RefundPaymentError =
  | { kind: "facilitator_error"; message: string }
  | { kind: "invalid_amount"; message: string };

/**
 * Issues an on-chain USDC refund from the Server Wallet back to the payer.
 * Used when the platform-side action fails after settlement. Caller must
 * hold a status-scoped charge transition so refunds are not double-issued.
 *
 * Refunds go through the CDP SDK directly (cdp.evm.sendTransaction for EVM,
 * the solana/refundSolana module for Solana), NOT through the facilitator.
 * The facilitator only handles agent->merchant; this is merchant->agent.
 */
export async function refundPayment(
  input: RefundPaymentInput
): Promise<RefundPaymentResult> {
  if (input.amountUsdc <= 0) {
    return {
      ok: false,
      error: {
        kind: "invalid_amount",
        message: "Refund amount must be greater than zero.",
      },
    };
  }

  try {
    const cdp = getCdpClient();

    if (input.network.isEvm) {
      return await refundEvm(cdp, input);
    }

    return await refundSolanaViaModule(input);
  } catch (err) {
    console.error("[refundPayment] Refund threw:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "facilitator_error",
        message: err instanceof Error ? err.message : "Unknown error during refund.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Encodes an ERC-20 transfer(address,uint256) calldata as a hex string.
 * No external ABI library needed; the encoding is deterministic.
 */
function encodeErc20TransferCalldata(
  toAddress: string,
  amountAtomic: bigint
): `0x${string}` {
  // transfer(address,uint256) selector = keccak256("transfer(address,uint256)")[0:4]
  const selector = "a9059cbb";
  const paddedTo = toAddress.toLowerCase().replace("0x", "").padStart(64, "0");
  const paddedAmount = amountAtomic.toString(16).padStart(64, "0");
  return `0x${selector}${paddedTo}${paddedAmount}`;
}

async function refundEvm(
  cdp: CdpClient,
  input: RefundPaymentInput
): Promise<RefundPaymentResult> {
  // The Server Wallet that received the payment is the refund sender.
  const senderAddress = getRecipientAddress(input.network);
  if (!senderAddress) {
    return {
      ok: false,
      error: {
        kind: "facilitator_error",
        message: "X402_RECIPIENT_EVM env var not set. Cannot issue EVM refund.",
      },
    };
  }

  const atomicAmount = BigInt(
    usdcToAtomic(input.amountUsdc, input.network.usdcDecimals)
  );
  const calldata = encodeErc20TransferCalldata(input.payerAddress, atomicAmount);

  // CDP sendTransaction for EVM. The CDP SDK speaks the same short network
  // names as WalletChain for base, polygon, and arbitrum.
  const result = await cdp.evm.sendTransaction({
    address: senderAddress as `0x${string}`,
    transaction: {
      to: input.network.usdcAddress as `0x${string}`,
      data: calldata,
      value: BigInt(0),
    },
    network: input.network.name as "base" | "polygon" | "arbitrum",
  });

  return {
    ok: true,
    refundTxHash: result.transactionHash,
    refundedAt: new Date().toISOString(),
  };
}

async function refundSolanaViaModule(
  input: RefundPaymentInput
): Promise<RefundPaymentResult> {
  // Delegate to the dedicated Solana refund module.
  const { refundSolana } = await import("@/lib/x402/solana/refundSolana");

  const result = await refundSolana({
    payerAddress: input.payerAddress,
    amountUsdc: input.amountUsdc,
    network: input.network,
    reason: input.reason,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: {
        kind: "facilitator_error",
        message: result.error.message,
      },
    };
  }

  return {
    ok: true,
    refundTxHash: result.refundTxHash,
    refundedAt: new Date().toISOString(),
  };
}

/**
 * Maps the facilitator's invalidReason string to a typed error variant.
 *
 * The @x402/core SDK does not define an exhaustive set of invalidReason
 * values. The mapping below covers known reasons from the Coinbase-hosted
 * facilitator. Unknown reasons fall through to "facilitator_error".
 */
function mapVerifyInvalidReason(
  reason: string | undefined,
  message: string | undefined,
  payer: string | undefined,
  input: VerifyPaymentInput,
  payload: PaymentPayload
): VerifyPaymentError {
  const displayMessage = message || reason || "Verification failed.";
  const reasonLower = (reason || "").toLowerCase();

  if (reasonLower.includes("signature") || reasonLower.includes("invalid_signature")) {
    return { kind: "invalid_signature", message: displayMessage };
  }

  if (reasonLower.includes("amount") || reasonLower.includes("insufficient")) {
    // The received amount here is display-only error context, not settlement
    // math, so the float division is acceptable.
    const receivedAtomic = payload.accepted?.amount;
    return {
      kind: "amount_mismatch",
      expected: input.amountUsdc,
      received: receivedAtomic
        ? Number(receivedAtomic) / 10 ** input.network.usdcDecimals
        : 0,
    };
  }

  if (reasonLower.includes("replay") || reasonLower.includes("nonce")) {
    const nonce = extractNonceFromPayload(payload) ?? "unavailable";
    return { kind: "replay_detected", nonce };
  }

  if (reasonLower.includes("sanction") || reasonLower.includes("kyt") || reasonLower.includes("blocked")) {
    return { kind: "kyt_sanctioned", payerAddress: payer ?? "unavailable" };
  }

  return { kind: "facilitator_error", message: displayMessage };
}

/**
 * Maps the facilitator's settle errorReason to a typed error variant.
 */
function mapSettleErrorReason(
  reason: string | undefined,
  message: string | undefined
): SettlePaymentError {
  const displayMessage = message || reason || "Settlement failed.";
  const reasonLower = (reason || "").toLowerCase();

  if (reasonLower.includes("not_verified") || reasonLower.includes("unverified")) {
    return { kind: "not_verified", message: displayMessage };
  }

  if (reasonLower.includes("insufficient") || reasonLower.includes("balance")) {
    return { kind: "insufficient_funds", message: displayMessage };
  }

  if (reasonLower.includes("timeout") || reasonLower.includes("timed_out")) {
    return { kind: "timeout", message: displayMessage };
  }

  return { kind: "facilitator_error", message: displayMessage };
}
