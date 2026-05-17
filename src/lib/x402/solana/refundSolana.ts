import "server-only";

import type { NetworkConfig } from "@/lib/x402/networks";
import { getCdpClient } from "@/lib/x402/facilitator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefundSolanaInput {
  payerAddress: string;
  amountUsdc: number;
  network: NetworkConfig;
  reason: string;
}

export type RefundSolanaResult =
  | { ok: true; refundTxHash: string }
  | {
      ok: false;
      error: { kind: "build_failed" | "send_failed" | "timeout"; message: string };
    };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Send a USDC SPL token refund on Solana.
 *
 * Uses CDP's sendTransaction API which handles transaction signing internally.
 * The CDP Server Wallet builds and signs the SPL token transfer.
 *
 * The CDP SDK's solana.sendTransaction signs and sends in one call when the
 * server wallet owns the funds. For SPL token transfers, we build the
 * transaction instruction set and serialize it.
 *
 * Since CDP SDK abstracts the transaction building for Solana server wallets,
 * we use a simplified approach: build a minimal transfer instruction via
 * the Solana programs and let CDP handle signing.
 */
export async function refundSolana(
  input: RefundSolanaInput
): Promise<RefundSolanaResult> {
  const senderAddress = process.env.X402_RECIPIENT_SOLANA;
  if (!senderAddress) {
    return {
      ok: false,
      error: {
        kind: "build_failed",
        message: "X402_RECIPIENT_SOLANA env var not set. Cannot issue Solana refund.",
      },
    };
  }

  try {
    const cdp = getCdpClient();

    // CDP Solana network mapping (testnets removed from registry)
    const cdpNetwork = "solana" as const;

    // For SPL token transfers via CDP, we need to build the transaction
    // using @solana/kit primitives and send via cdp.solana.sendTransaction.
    //
    // The CDP SDK can sign transactions for its managed wallets. We build
    // the SPL TransferChecked instruction, serialize to base64, and send.

    const {
      address: solAddress,
      createTransactionMessage,
      setTransactionMessageFeePayer,
      setTransactionMessageLifetimeUsingBlockhash,
      appendTransactionMessageInstructions,
      compileTransaction,
      getBase64EncodedWireTransaction,
      createNoopSigner,
      createSolanaRpc,
    } = await import("@solana/kit");

    const rpc = createSolanaRpc(input.network.rpcUrl);

    // Get recent blockhash for transaction lifetime
    const { value: latestBlockhash } = await rpc
      .getLatestBlockhash()
      .send();

    const senderAddr = solAddress(senderAddress);
    const recipientAddr = solAddress(input.payerAddress);
    const usdcMint = solAddress(input.network.usdcAddress);

    // Compute atomic amount (USDC has 6 decimals on Solana)
    const atomicAmount = BigInt(
      Math.round(input.amountUsdc * 10 ** input.network.usdcDecimals)
    );

    // Build the SPL Token TransferChecked instruction manually.
    // The SPL Token program ID is constant.
    const SPL_TOKEN_PROGRAM_ID = solAddress(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    );

    // Compute Associated Token Addresses (ATAs) for source and destination
    const ASSOCIATED_TOKEN_PROGRAM_ID = solAddress(
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
    );

    const sourceAta = await findAssociatedTokenAddress(
      senderAddr,
      usdcMint,
      SPL_TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const destinationAta = await findAssociatedTokenAddress(
      recipientAddr,
      usdcMint,
      SPL_TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Build TransferChecked instruction data
    // Instruction index 12 = TransferChecked
    // Layout: [u8 instruction, u64 amount, u8 decimals]
    const instructionData = new Uint8Array(10);
    instructionData[0] = 12; // TransferChecked
    const amountView = new DataView(instructionData.buffer);
    amountView.setBigUint64(1, atomicAmount, true); // little-endian
    instructionData[9] = input.network.usdcDecimals;

    const transferInstruction = {
      programAddress: SPL_TOKEN_PROGRAM_ID,
      accounts: [
        { address: sourceAta, role: 2 }, // source (writable)
        { address: usdcMint, role: 0 }, // mint (readonly)
        { address: destinationAta, role: 2 }, // destination (writable)
        { address: senderAddr, role: 3 }, // authority (signer + writable)
      ],
      data: instructionData,
    };

    // Build transaction message
    const signer = createNoopSigner(senderAddr);
    const txMsg = appendTransactionMessageInstructions(
      [transferInstruction],
      setTransactionMessageLifetimeUsingBlockhash(
        latestBlockhash,
        setTransactionMessageFeePayer(
          senderAddr,
          createTransactionMessage({ version: 0 })
        )
      )
    );

    // Compile and encode
    const compiled = compileTransaction(txMsg);
    const base64Tx = getBase64EncodedWireTransaction(compiled);

    // Sign and send via CDP
    const result = await cdp.solana.sendTransaction({
      network: cdpNetwork,
      transaction: base64Tx,
    });

    console.log(`[refundSolana] Refund sent: ${result.signature}, amount: ${input.amountUsdc} USDC, reason: ${input.reason}`);

    return { ok: true, refundTxHash: result.signature };
  } catch (err) {
    console.error("[refundSolana] Failed:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "send_failed",
        message: err instanceof Error
          ? err.message
          : "Unexpected error during Solana refund.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// ATA derivation
// ---------------------------------------------------------------------------

/**
 * Derives the Associated Token Address for a given wallet and mint.
 * Uses the standard PDA derivation: sha256([wallet, tokenProgramId, mint], ataProgramId).
 */
async function findAssociatedTokenAddress(
  wallet: ReturnType<typeof import("@solana/kit").address>,
  mint: ReturnType<typeof import("@solana/kit").address>,
  tokenProgramId: ReturnType<typeof import("@solana/kit").address>,
  ataProgramId: ReturnType<typeof import("@solana/kit").address>
): Promise<ReturnType<typeof import("@solana/kit").address>> {
  // Use @solana/kit getProgramDerivedAddress if available, otherwise
  // fall back to manual derivation.
  const { getProgramDerivedAddress, address: solAddress } = await import(
    "@solana/kit"
  );

  const [pda] = await getProgramDerivedAddress({
    programAddress: ataProgramId,
    seeds: [
      // Wallet address as bytes
      new TextEncoder().encode(String(wallet)).length === 32
        ? new TextEncoder().encode(String(wallet))
        : bs58Decode(String(wallet)),
      // Token program ID as bytes
      bs58Decode(String(tokenProgramId)),
      // Mint address as bytes
      bs58Decode(String(mint)),
    ],
  });

  return pda;
}

function bs58Decode(str: string): Uint8Array {
  // Use a simple base58 decode without importing bs58 at module level
  // since the dynamic import approach is used for @solana/kit.
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes: number[] = [];
  for (const char of str) {
    let carry = ALPHABET.indexOf(char);
    if (carry < 0) throw new Error(`Invalid base58 character: ${char}`);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading zeros
  for (const char of str) {
    if (char !== "1") break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}
