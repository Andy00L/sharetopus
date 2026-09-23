import "server-only";

/**
 * Sharetopus' own x402 facilitator for Arc mainnet.
 *
 * Every other network hands verify and settle to a hosted facilitator over
 * HTTP. When this lane was built no hosted facilitator settled a plain
 * EIP-3009 authorization from an agent's own wallet on Arc, so it runs the
 * exact scheme in process, against the protocol's own implementation
 * (ExactEvmScheme from @x402/evm, version-matched to @x402/core), driven by
 * a viem-backed signer over the Arc operations key. Circle's Facilitator
 * Service has settled Arc since September 2026; moving this lane to it needs
 * a Circle API key and is tracked separately.
 *
 * The agent still pays no gas and never broadcasts: it signs an EIP-3009
 * authorization exactly as it would for Base, and the operations wallet
 * submits transferWithAuthorization for it (about 0.0015 USDC of gas, since
 * gas on Arc is USDC itself). Every broadcast goes through
 * chain/broadcastCall.ts, which never sends the same payment twice.
 *
 * Called by: facilitatorClient.getFacilitatorClient (arc_local lane)
 * Tables touched: none
 * Env: X402_ARC_KEY and the Arc RPC, both through arc/arcChain.ts
 */

import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { encodeFunctionData, type VerifyTypedDataActionParameters } from "viem";

import { getArcSigner } from "@/lib/x402/arc/arcChain";
import { broadcastCall, type OperatorSigner } from "@/lib/x402/chain/broadcastCall";

/**
 * Settlement confirmation ceiling. Arc has deterministic sub-second
 * finality, so this only matters when the RPC stalls, and 20s leaves room in
 * the paid routes' 60s budget for verify, the charge writes and the paid
 * action itself.
 */
const CONFIRMATION_TIMEOUT_MS = 20_000;

let cachedArcScheme: ExactEvmScheme | null = null;

/**
 * The Arc exact-scheme facilitator, built once per process.
 *
 * Throws when the operations key is missing or malformed, matching the
 * contract of getFacilitatorClient for the other lanes: callers wrap
 * facilitator access in try/catch and map a throw to facilitator_error, so a
 * misconfigured Arc lane fails closed before anything settles.
 */
export function getArcFacilitator(): ExactEvmScheme {
  if (cachedArcScheme) return cachedArcScheme;

  const signerResult = getArcSigner();
  if (!signerResult.ok) {
    throw new Error(`[getArcFacilitator] ${signerResult.message}`);
  }

  cachedArcScheme = new ExactEvmScheme(buildArcFacilitatorSigner(signerResult.signer));
  return cachedArcScheme;
}

/**
 * Adapts the Arc signer to the FacilitatorEvmSigner shape @x402/evm wants.
 *
 * Written out method by method rather than handing over a client: viem types
 * its contract helpers against a concrete Abi while the x402 interface
 * passes `readonly unknown[]`, and both broadcast methods must go through
 * broadcastCall.
 */
function buildArcFacilitatorSigner(
  signer: OperatorSigner,
): ConstructorParameters<typeof ExactEvmScheme>[0] {
  const { account, publicClient } = signer;

  return {
    getAddresses: () => [account.address],

    readContract: (args) =>
      publicClient.readContract({
        address: args.address,
        abi: args.abi,
        functionName: args.functionName,
        args: args.args ? [...args.args] : undefined,
      }),

    // The x402 signer interface types the EIP-712 pieces as loose records,
    // viem types them as a concrete TypedData definition, and neither side
    // can be widened from here. The cast is the adapter boundary and holds
    // because the scheme builds these fields from the EIP-3009 typed-data
    // definition before handing them over, never from client input.
    verifyTypedData: (args) =>
      publicClient.verifyTypedData({
        address: args.address,
        domain: args.domain,
        types: args.types,
        primaryType: args.primaryType,
        message: args.message,
        signature: args.signature,
      } as VerifyTypedDataActionParameters),

    writeContract: (args) =>
      broadcastCall(
        signer,
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
      broadcastCall(signer, { to: args.to, data: args.data }, "sendTransaction"),

    // The transfer is already broadcast when this runs, so failing to read
    // its receipt (timeout, RPC error) means "outcome unknown". It is
    // reported as status "pending" instead of thrown: the scheme turns a
    // throw into a failure with an empty transaction, which would drop the
    // hash reconciliation needs to find the money. Any status but "success"
    // fails the settle as indeterminate (facilitator.classifySettleFailure)
    // with the hash attached.
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
