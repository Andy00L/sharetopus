import "server-only";

/**
 * Sends a USDC ERC-20 refund on Celo.
 *
 * Celo settlements run through the Celo facilitator, which has no merchant
 * to agent path, and the CDP SDK cannot send on Celo (its EVM network union
 * is base | polygon | arbitrum). Refunds are therefore signed locally with
 * the dedicated Celo operations key (the same wallet that receives payments
 * as X402_RECIPIENT_CELO) and broadcast over the Celo RPC (Forno) through
 * chain/broadcastCall.ts, so a send whose reply is lost is resent as the
 * same bytes, and a send that may have gone out keeps its hash.
 *
 * When X402_CELO_ATTRIBUTION_TAG is set, an ERC-8021 Schema 0 attribution
 * suffix is appended to the transfer calldata so refunds show up as tagged
 * project volume on Celo dashboards. The suffix is trailing metadata: the
 * EVM ignores it during execution.
 * sourceRef: celo-org/attribution-tags INDEXERS.md (wire format:
 * [code ASCII][length:1][schema:1 = 0x00][marker:16 = 0x80218021 x8]).
 *
 * Called by: facilitator.refundPayment (celo lane)
 * Tables touched: none
 * Env: X402_CELO_REFUND_KEY (refund sender key, held by the operator),
 *      X402_CELO_ATTRIBUTION_TAG (optional ERC-8021 code, celo_...)
 */

import type { Hex } from "viem";
import { celo } from "viem/chains";

import { buildOperatorSigner, type OperatorSigner } from "@/lib/x402/chain/broadcastCall";
import { loadOperatorAccount } from "@/lib/x402/chain/operatorKey";
import {
  sendOperatorRefund,
  type RefundSendInput,
  type RefundSendResult,
} from "@/lib/x402/chain/refundSender";
import { buildUsdcTransferCall } from "@/lib/x402/chain/usdcTransfer";
import { getRpcUrl } from "@/lib/x402/config";
import type { EvmNetworkConfig } from "@/lib/x402/networks";

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

let cachedCeloRefundSigner: OperatorSigner | null = null;

export async function refundCelo(input: RefundSendInput): Promise<RefundSendResult> {
  const { network } = input;
  if (network.family !== "evm") {
    return { status: "not_sent", message: "Celo refunds need an EVM network entry." };
  }

  const signerResult = getCeloRefundSigner(network);
  if (!signerResult.ok) return { status: "not_sent", message: signerResult.message };

  const transfer = buildUsdcTransferCall({
    network,
    recipientAddress: input.payerAddress,
    amountUsdc: input.amountUsdc,
  });
  if (!transfer.ok) return { status: "not_sent", message: transfer.message };

  return sendOperatorRefund({
    signer: signerResult.signer,
    call: { to: transfer.usdcContract, data: appendAttributionSuffix(transfer.calldata) },
    input,
  });
}

/** The Celo refund signer, built once per process. Errors as values. */
function getCeloRefundSigner(
  network: EvmNetworkConfig,
): { ok: true; signer: OperatorSigner } | { ok: false; message: string } {
  if (cachedCeloRefundSigner) return { ok: true, signer: cachedCeloRefundSigner };

  const accountResult = loadOperatorAccount("X402_CELO_REFUND_KEY");
  if (!accountResult.ok) {
    return { ok: false, message: `${accountResult.message} Cannot issue the Celo refund.` };
  }

  cachedCeloRefundSigner = buildOperatorSigner({
    account: accountResult.account,
    chain: celo,
    rpcUrl: getRpcUrl(network),
  });
  return { ok: true, signer: cachedCeloRefundSigner };
}

/**
 * Appends the ERC-8021 Schema 0 suffix for X402_CELO_ATTRIBUTION_TAG to the
 * calldata. An unset tag is a no-op; an invalid tag logs a warning and the
 * refund goes out untagged rather than failing (attribution is additive,
 * the refund itself must not depend on it).
 */
function appendAttributionSuffix(calldata: Hex): Hex {
  const attributionCode = process.env.X402_CELO_ATTRIBUTION_TAG;
  if (!attributionCode) return calldata;

  if (!ATTRIBUTION_CODE_PATTERN.test(attributionCode)) {
    console.warn(
      "[appendAttributionSuffix] X402_CELO_ATTRIBUTION_TAG is not a valid ERC-8021 code (lowercase [a-z0-9_], 1-32 chars); sending the refund untagged.",
    );
    return calldata;
  }

  const codeHex = Buffer.from(attributionCode, "ascii").toString("hex");
  const lengthHex = attributionCode.length.toString(16).padStart(2, "0");
  return `${calldata}${codeHex}${lengthHex}${ERC8021_SCHEMA_FLAT_HEX}${ERC8021_MARKER_HEX}`;
}
