import "server-only";

/**
 * Send a USDC ERC-20 refund on Celo.
 *
 * Celo settlements run through the Celo facilitator, which has no
 * merchant->agent path, and the CDP SDK cannot send on Celo (its EVM
 * network union is base | polygon | arbitrum). Refunds are therefore
 * signed locally with the dedicated Celo operations key (the same wallet
 * that receives payments as X402_RECIPIENT_CELO) and broadcast through the
 * registry RPC (Forno).
 *
 * When X402_CELO_ATTRIBUTION_TAG is set, an ERC-8021 Schema 0 attribution
 * suffix is appended to the transfer calldata so refunds show up as tagged
 * project volume on Celo dashboards. The suffix is trailing metadata: the
 * EVM ignores it during execution.
 * sourceRef: celo-org/attribution-tags INDEXERS.md (wire format:
 * [code ASCII][length:1][schema:1 = 0x00][marker:16 = 0x80218021 x8]).
 *
 * Called by: facilitator.ts refundPayment (Celo branch, dynamic import)
 * Tables touched: none
 * Env: X402_CELO_REFUND_KEY (refund sender key, held by the operator),
 *      X402_CELO_ATTRIBUTION_TAG (optional ERC-8021 code, celo_...)
 */

import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

import { encodeErc20TransferCalldata } from "@/lib/x402/facilitator";
import type { NetworkConfig } from "@/lib/x402/networks";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefundCeloInput {
  payerAddress: string;
  amountUsdc: number;
  network: NetworkConfig;
  reason: string;
}

export type RefundCeloResult =
  | { ok: true; refundTxHash: string }
  | {
      ok: false;
      error: { kind: "build_failed" | "send_failed"; message: string };
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * ERC-8021 trailing marker: 0x80218021 repeated 8 times (16 bytes).
 * sourceRef: celo-org/attribution-tags sdk/src/index.ts (ERC_8021_MARKER)
 */
const ERC8021_MARKER_HEX = "80218021802180218021802180218021";

/** ERC-8021 schema id 0: flat code list. sourceRef: INDEXERS.md table. */
const ERC8021_SCHEMA_FLAT_HEX = "00";

/**
 * Celo attribution code shape: lowercase, 1 to 32 chars.
 * sourceRef: celo-org/attribution-tags sdk/src/index.ts (CODE_RE)
 */
const ATTRIBUTION_CODE_PATTERN = /^[a-z0-9_]{1,32}$/;

/** 32-byte hex private key, 0x prefix optional. */
const PRIVATE_KEY_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;

/** 20-byte hex EVM address. */
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function refundCelo(
  input: RefundCeloInput
): Promise<RefundCeloResult> {
  const refundKey = process.env.X402_CELO_REFUND_KEY;
  if (!refundKey) {
    return {
      ok: false,
      error: {
        kind: "build_failed",
        message:
          "X402_CELO_REFUND_KEY env var not set. Cannot issue Celo refund.",
      },
    };
  }
  if (!PRIVATE_KEY_PATTERN.test(refundKey)) {
    // Distinct from the missing-key case; the key itself is never logged.
    return {
      ok: false,
      error: {
        kind: "build_failed",
        message:
          "X402_CELO_REFUND_KEY is not a 32-byte hex key. Cannot issue Celo refund.",
      },
    };
  }
  if (!EVM_ADDRESS_PATTERN.test(input.payerAddress)) {
    return {
      ok: false,
      error: {
        kind: "build_failed",
        message:
          "Payer address is not a valid EVM address; refusing to build the Celo refund.",
      },
    };
  }

  try {
    const normalizedKey = (
      refundKey.startsWith("0x") ? refundKey : `0x${refundKey}`
    ) as `0x${string}`;
    const senderAccount = privateKeyToAccount(normalizedKey);
    const walletClient = createWalletClient({
      account: senderAccount,
      chain: celo,
      transport: http(input.network.rpcUrl),
    });

    const atomicAmount = BigInt(
      usdcToAtomic(input.amountUsdc, input.network.usdcDecimals)
    );
    const transferCalldata = encodeErc20TransferCalldata(
      input.payerAddress,
      atomicAmount
    );
    const calldata = appendAttributionSuffix(transferCalldata);

    const refundTxHash = await walletClient.sendTransaction({
      to: input.network.usdcAddress as `0x${string}`,
      data: calldata,
      value: BigInt(0),
    });

    console.log(
      `[refundCelo] Refund sent: ${refundTxHash}, amount: ${input.amountUsdc} USDC, reason: ${input.reason}`
    );

    return { ok: true, refundTxHash };
  } catch (err) {
    console.error(
      "[refundCelo] Failed:",
      err instanceof Error ? err.message : err
    );
    return {
      ok: false,
      error: {
        kind: "send_failed",
        message:
          err instanceof Error
            ? err.message
            : "Unexpected error during Celo refund.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// ERC-8021 attribution suffix
// ---------------------------------------------------------------------------

/**
 * Appends the ERC-8021 Schema 0 suffix for X402_CELO_ATTRIBUTION_TAG to the
 * calldata. An unset tag is a no-op; an invalid tag logs a warning and the
 * refund goes out untagged rather than failing (attribution is additive,
 * the refund itself must not depend on it).
 */
function appendAttributionSuffix(calldata: `0x${string}`): `0x${string}` {
  const attributionCode = process.env.X402_CELO_ATTRIBUTION_TAG;
  if (!attributionCode) return calldata;

  if (!ATTRIBUTION_CODE_PATTERN.test(attributionCode)) {
    console.warn(
      "[refundCelo] X402_CELO_ATTRIBUTION_TAG is not a valid ERC-8021 code (lowercase [a-z0-9_], 1-32 chars); sending the refund untagged."
    );
    return calldata;
  }

  const codeHex = Buffer.from(attributionCode, "ascii").toString("hex");
  const lengthHex = attributionCode.length.toString(16).padStart(2, "0");
  return `${calldata}${codeHex}${lengthHex}${ERC8021_SCHEMA_FLAT_HEX}${ERC8021_MARKER_HEX}`;
}
