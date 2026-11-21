import "server-only";

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

// ERC-8021 Schema 0 suffix: [code][code length: 1 byte][schema: 1 byte][marker: 16 bytes], trailing calldata the EVM
// ignores (github.com/celo-org/attribution-tags/blob/main/INDEXERS.md).
const ERC8021_MARKER_HEX = "80218021802180218021802180218021";

const ERC8021_SCHEMA_FLAT_HEX = "00";

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
