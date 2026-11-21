import "server-only";

import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import {
  encodeFunctionData,
  isAddress,
  isHex,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { verifyTypedData } from "viem/actions";

import { getArcSigner } from "@/lib/x402/arc/arcChain";
import { broadcastCall, type OperatorSigner } from "@/lib/x402/chain/broadcastCall";

const CONFIRMATION_TIMEOUT_MS = 20_000;

let cachedArcScheme: ExactEvmScheme | null = null;

export type ArcFacilitatorResult =
  | { ok: true; facilitator: ExactEvmScheme }
  | { ok: false; message: string };

export function getArcFacilitator(): ArcFacilitatorResult {
  if (cachedArcScheme) return { ok: true, facilitator: cachedArcScheme };

  const signerResult = getArcSigner();
  if (!signerResult.ok) return { ok: false, message: signerResult.message };

  cachedArcScheme = new ExactEvmScheme(buildArcFacilitatorSigner(signerResult.signer));
  return { ok: true, facilitator: cachedArcScheme };
}

function buildArcFacilitatorSigner(
  signer: OperatorSigner,
): ConstructorParameters<typeof ExactEvmScheme>[0] {
  const { account, publicClient } = signer;

  const broadcastForScheme = async (
    call: { to: Address; data: Hex; gas?: bigint },
    operationName: string,
  ): Promise<Hex> => {
    const broadcast = await broadcastCall(signer, call, operationName);
    // @x402/evm settleEIP3009 reads a throw as a failed settle with an empty transaction.
    if (broadcast.status === "not_sent") throw new Error(broadcast.message);
    return broadcast.transactionHash;
  };

  return {
    getAddresses: () => [account.address],

    readContract: (args) =>
      publicClient.readContract({
        address: args.address,
        abi: args.abi,
        functionName: args.functionName,
        args: args.args ? [...args.args] : undefined,
      }),

    verifyTypedData: (args) =>
      verifyTypedData(publicClient, {
        address: args.address,
        domain: toTypedDataDomain(args.domain),
        types: args.types,
        primaryType: args.primaryType,
        message: args.message,
        signature: args.signature,
      }),

    writeContract: (args) =>
      broadcastForScheme(
        {
          to: args.address,
          data: encodeFunctionData({
            abi: args.abi,
            functionName: args.functionName,
            args: [...args.args],
          }),
          gas: args.gas,
        },
        "writeContract",
      ),

    sendTransaction: (args) =>
      broadcastForScheme({ to: args.to, data: args.data }, "sendTransaction"),

    // @x402/evm settleEIP3009 turns a throw here into a failed settle with an empty transaction,
    // which drops the broadcast hash; a non-success status keeps it.
    waitForTransactionReceipt: async (args) => {
      try {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: args.hash,
          timeout: CONFIRMATION_TIMEOUT_MS,
        });
        return { status: receipt.status, logs: receipt.logs };
      } catch (error) {
        console.error(
          `[buildArcFacilitatorSigner] No receipt for ${args.hash} within ${CONFIRMATION_TIMEOUT_MS} ms (${error instanceof Error ? error.message : String(error)}); reporting it as pending.`,
        );
        return { status: "pending" };
      }
    },

    getCode: (args) => publicClient.getCode({ address: args.address }),
  };
}

function toTypedDataDomain(domain: Record<string, unknown>): TypedDataDomain {
  const { name, version, chainId, verifyingContract, salt } = domain;
  return {
    name: typeof name === "string" ? name : undefined,
    version: typeof version === "string" ? version : undefined,
    chainId:
      typeof chainId === "number" || typeof chainId === "bigint"
        ? chainId
        : undefined,
    verifyingContract:
      typeof verifyingContract === "string" &&
      isAddress(verifyingContract, { strict: false })
        ? verifyingContract
        : undefined,
    salt: isHex(salt) ? salt : undefined,
  };
}
