import "server-only";

/**
 * Thin wrapper around the Coinbase CDP facilitator for x402 payment protocol.
 *
 * Three operations: verify a payment header, settle a verified payment, and
 * refund a settled payment. Each returns an errors-as-values result.
 *
 * Phase 4.1+ endpoints call these; Phase 4.0 ships the wrapper.
 *
 * Called by: x402 route handlers (Phase 4.1+)
 * Tables touched: none (the facilitator is external; DB writes happen in the route handler)
 *
 * SDK divergence notes (from @x402/core v2.11.0):
 *   - Network is CAIP format ("eip155:8453") in the SDK, not WalletChain ("base").
 *     NetworkConfig.caipNetwork bridges the two. See src/lib/x402/networks.ts.
 *   - VerifyResponse uses { isValid, invalidReason, payer }, not structured error unions.
 *     This wrapper maps invalidReason strings to typed error kinds.
 *   - SettleResponse uses { success, transaction, network }, not the structured result
 *     from the prompt spec. The "transaction" field is the tx hash.
 *   - SettleResponse does not include blockNumber or facilitatorFeeUsdc. These fields
 *     are set to null in the wrapper result. Phase 4.1 may fetch them from on-chain data.
 *   - Refunds go through CDP SDK directly (cdp.evm.sendTransaction), not through the
 *     facilitator. This matches the prompt spec.
 */

import { CdpClient } from "@coinbase/cdp-sdk";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { NetworkConfig } from "@/lib/x402/networks";

// ---------------------------------------------------------------------------
// CDP Client singleton
// ---------------------------------------------------------------------------

let cdpClientInstance: CdpClient | null = null;

/**
 * Lazy singleton CDP client. Reads CDP_API_KEY_ID, CDP_API_KEY_SECRET,
 * CDP_WALLET_SECRET from env automatically. Throws on first access if any
 * of the three env vars is missing (fail-fast on misconfiguration).
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
// Facilitator Client singleton
// ---------------------------------------------------------------------------

const DEFAULT_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

let facilitatorClientInstance: HTTPFacilitatorClient | null = null;

function getFacilitatorClient(): HTTPFacilitatorClient {
  if (facilitatorClientInstance) return facilitatorClientInstance;
  const url = process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL;
  facilitatorClientInstance = new HTTPFacilitatorClient({ url });
  return facilitatorClientInstance;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export interface VerifyPaymentInput {
  /** Raw X-PAYMENT header value from the incoming request. */
  paymentHeader: string;

  /** Resource URL the agent is paying to access. Used for replay protection. */
  resourceUrl: string;

  /** Expected payment amount in USDC units (human, not wei). */
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
 * Verifies an X-PAYMENT header against the facilitator. Does NOT settle yet.
 * The facilitator runs KYT (sanctions screening) as part of verify; sanctioned
 * payers are rejected here, before any DB write.
 */
export async function verifyPayment(
  input: VerifyPaymentInput
): Promise<VerifyPaymentResult> {
  // 1. Decode the X-PAYMENT header
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(input.paymentHeader);
  } catch (err) {
    console.error("[X402Facilitator] Failed to decode X-PAYMENT header:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "malformed_header",
        message: "X-PAYMENT header is not valid base64-encoded JSON.",
      },
    };
  }

  // 2. Build expected requirements from the route configuration
  const atomicAmount = String(
    Math.round(input.amountUsdc * 10 ** input.network.usdcDecimals)
  );

  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: input.network.caipNetwork as `${string}:${string}`,
    asset: input.network.usdcAddress,
    amount: atomicAmount,
    payTo: input.recipientAddress,
    maxTimeoutSeconds: 300,
    extra: {},
  };

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
      // Extract nonce from the EVM payload authorization
      const nonce = extractNonceFromPayload(paymentPayload) ?? "unknown";
      return {
        ok: true,
        payerAddress: response.payer ?? "unknown",
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
    console.error("[X402Facilitator] verifyPayment threw:", err instanceof Error ? err.message : err);
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
 * the transaction and waits for confirmation (typically ~200ms on Base).
 * Returns the tx hash, block number, and the facilitator fee taken.
 *
 * Note: blockNumber and facilitatorFeeUsdc are not available from the
 * @x402/core SettleResponse (SDK divergence). They are set to null here.
 * Phase 4.1 may enrich these from on-chain transaction receipts.
 */
export async function settlePayment(
  input: SettlePaymentInput
): Promise<SettlePaymentResult> {
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(input.paymentHeader);
  } catch (err) {
    console.error("[X402Facilitator] Failed to decode header for settle:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "facilitator_error",
        message: "Failed to decode payment header for settlement.",
      },
    };
  }

  // Use the requirements the client accepted (embedded in the payload)
  const requirements: PaymentRequirements = paymentPayload.accepted ?? {
    scheme: "exact",
    network: input.network.caipNetwork as `${string}:${string}`,
    asset: input.network.usdcAddress,
    amount: "0",
    payTo: "",
    maxTimeoutSeconds: 300,
    extra: {},
  };

  try {
    const facilitator = getFacilitatorClient();
    const response = await facilitator.settle(paymentPayload, requirements);

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
    console.error("[X402Facilitator] settlePayment threw:", err instanceof Error ? err.message : err);
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

  /** Reason for refund. Stored in metadata for observability. */
  reason: string;
}

export type RefundPaymentResult =
  | { ok: true; refundTxHash: string; refundedAt: string }
  | { ok: false; error: RefundPaymentError };

export type RefundPaymentError =
  | { kind: "wallet_insufficient_gas"; network: string; message: string }
  | { kind: "wallet_insufficient_usdc"; network: string; message: string }
  | { kind: "facilitator_error"; message: string }
  | { kind: "invalid_amount"; message: string };

/**
 * Issues an on-chain USDC refund from the Server Wallet back to the payer.
 * Used when the platform-side action fails (post upload error, OAuth never
 * completed, etc). Caller must hold a transaction-like state guard so refunds
 * are not double-issued.
 *
 * Refunds go through the CDP SDK directly (cdp.evm.sendTransaction for EVM,
 * cdp.solana.sendTransaction for Solana), NOT through the facilitator.
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

    // Solana refund path
    return await refundSolana(cdp, input);
  } catch (err) {
    console.error("[X402Facilitator] refundPayment threw:", err instanceof Error ? err.message : err);
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
  const senderAddress = process.env.X402_RECIPIENT_EVM;
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
    Math.round(input.amountUsdc * 10 ** input.network.usdcDecimals)
  );
  const calldata = encodeErc20TransferCalldata(input.payerAddress, atomicAmount);

  // CDP sendTransaction for EVM.
  // The network name in WalletChain matches SendEvmTransactionBodyNetwork
  // for base, base-sepolia, polygon, arbitrum.
  const result = await cdp.evm.sendTransaction({
    address: senderAddress as `0x${string}`,
    transaction: {
      to: input.network.usdcAddress as `0x${string}`,
      data: calldata,
      value: BigInt(0),
    },
    network: input.network.name as "base" | "base-sepolia" | "polygon" | "arbitrum",
  });

  return {
    ok: true,
    refundTxHash: result.transactionHash,
    refundedAt: new Date().toISOString(),
  };
}

async function refundSolana(
  cdp: CdpClient,
  input: RefundPaymentInput
): Promise<RefundPaymentResult> {
  const senderAddress = process.env.X402_RECIPIENT_SOLANA;
  if (!senderAddress) {
    return {
      ok: false,
      error: {
        kind: "facilitator_error",
        message: "X402_RECIPIENT_SOLANA env var not set. Cannot issue Solana refund.",
      },
    };
  }

  // Solana SPL token transfers require building a transaction with the
  // SPL Token program instructions (finding ATAs, creating if needed, then
  // calling transferChecked). The CDP SDK's sendTransaction accepts a
  // base64-encoded serialized Solana transaction.
  //
  // Phase 4.2 will implement the full Solana refund path using @solana/kit
  // (available as a transitive dep via @coinbase/cdp-sdk). For Phase 4.0,
  // this returns an error indicating Solana refunds are not yet wired.
  void cdp;
  console.warn(`[X402Facilitator] Solana refund not yet implemented. Charge: ${input.originalTxHash}, payer: ${input.payerAddress}, amount: ${input.amountUsdc} USDC, reason: ${input.reason}`);

  return {
    ok: false,
    error: {
      kind: "facilitator_error",
      message:
        "Solana refunds are not yet implemented. " +
        "The refund has been logged for manual processing.",
    },
  };
}

/**
 * Attempts to extract the nonce from the payment payload.
 * EVM exact scheme stores it in payload.authorization.nonce.
 */
function extractNonceFromPayload(payload: PaymentPayload): string | null {
  const inner = payload.payload;
  if (inner && typeof inner === "object") {
    // EVM EIP-3009 exact scheme: payload.authorization.nonce
    const auth = (inner as Record<string, unknown>).authorization;
    if (auth && typeof auth === "object") {
      const nonce = (auth as Record<string, unknown>).nonce;
      if (typeof nonce === "string") return nonce;
    }

    // Permit2 scheme: payload.permit2Authorization.nonce
    const permit2Auth = (inner as Record<string, unknown>).permit2Authorization;
    if (permit2Auth && typeof permit2Auth === "object") {
      const nonce = (permit2Auth as Record<string, unknown>).nonce;
      if (typeof nonce === "string") return nonce;
    }
  }
  return null;
}

/**
 * Maps the facilitator's invalidReason string to a typed error variant.
 *
 * The @x402/core SDK does not define an exhaustive set of invalidReason values.
 * The mapping below covers known reasons from the Coinbase-hosted facilitator.
 * Unknown reasons fall through to "facilitator_error".
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
    const receivedAmount = payload.accepted?.amount;
    const expectedAtomic = Math.round(
      input.amountUsdc * 10 ** input.network.usdcDecimals
    );
    return {
      kind: "amount_mismatch",
      expected: input.amountUsdc,
      received: receivedAmount
        ? Number(receivedAmount) / 10 ** input.network.usdcDecimals
        : 0,
    };
  }

  if (reasonLower.includes("replay") || reasonLower.includes("nonce")) {
    const nonce = extractNonceFromPayload(payload) ?? "unknown";
    return { kind: "replay_detected", nonce };
  }

  if (reasonLower.includes("sanction") || reasonLower.includes("kyt") || reasonLower.includes("blocked")) {
    return { kind: "kyt_sanctioned", payerAddress: payer ?? "unknown" };
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
