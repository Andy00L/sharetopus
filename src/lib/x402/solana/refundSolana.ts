import "server-only";

/**
 * Send a USDC SPL token refund on Solana.
 *
 * Builds an SPL Token TransferChecked instruction from the Server Wallet's
 * associated token account (ATA) to the payer's ATA, compiles it with
 * @solana/kit, and hands the base64 wire transaction to CDP for signing and
 * sending (the CDP Server Wallet holds the key).
 *
 * Account roles come from the @solana/kit AccountRole enum: READONLY=0,
 * WRITABLE=1, READONLY_SIGNER=2, WRITABLE_SIGNER=3. Source and destination
 * ATAs must be WRITABLE non-signers (they are PDAs and cannot sign);
 * the owner is the only signer and CDP supplies that signature.
 *
 * Called by: facilitator.ts refundPayment (Solana branch)
 * Env: X402_RECIPIENT_SOLANA (refund sender = original payment recipient)
 */

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import bs58 from "bs58";

import type { NetworkConfig } from "@/lib/x402/networks";
import { getCdpClient } from "@/lib/x402/facilitator";
import { getRecipientAddress } from "@/lib/x402/config";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

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
      error: { kind: "build_failed" | "send_failed"; message: string };
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SPL Token program (constant program id). */
const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Associated Token Account program (constant program id). */
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function refundSolana(
  input: RefundSolanaInput
): Promise<RefundSolanaResult> {
  // The Server Wallet that received the payment is the refund sender.
  const senderAddress = getRecipientAddress(input.network);
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
    const rpc = createSolanaRpc(input.network.rpcUrl);

    // Get a recent blockhash for the transaction lifetime.
    const { value: latestBlockhash } = await rpc
      .getLatestBlockhash()
      .send();

    const senderAddr = address(senderAddress);
    const recipientAddr = address(input.payerAddress);
    const usdcMint = address(input.network.usdcAddress);

    const sourceAta = await findAssociatedTokenAddress(senderAddr, usdcMint);
    // The payer's ATA exists: the payment that is being refunded was sent
    // FROM it, and SPL token accounts are not closed by outgoing transfers
    // in this flow.
    const destinationAta = await findAssociatedTokenAddress(
      recipientAddr,
      usdcMint
    );

    const atomicAmount = BigInt(
      usdcToAtomic(input.amountUsdc, input.network.usdcDecimals)
    );

    // TransferChecked instruction data layout:
    // [u8 instruction=12, u64 amount little-endian, u8 decimals]
    const instructionData = new Uint8Array(10);
    instructionData[0] = 12;
    new DataView(instructionData.buffer).setBigUint64(1, atomicAmount, true);
    instructionData[9] = input.network.usdcDecimals;

    // TransferChecked account order: source, mint, destination, authority.
    const transferInstruction = {
      programAddress: address(SPL_TOKEN_PROGRAM_ID),
      accounts: [
        { address: sourceAta, role: AccountRole.WRITABLE },
        { address: usdcMint, role: AccountRole.READONLY },
        { address: destinationAta, role: AccountRole.WRITABLE },
        { address: senderAddr, role: AccountRole.READONLY_SIGNER },
      ],
      data: instructionData,
    };

    const txMessage = appendTransactionMessageInstructions(
      [transferInstruction],
      setTransactionMessageLifetimeUsingBlockhash(
        latestBlockhash,
        setTransactionMessageFeePayer(
          senderAddr,
          createTransactionMessage({ version: 0 })
        )
      )
    );

    const compiledTx = compileTransaction(txMessage);
    const base64Tx = getBase64EncodedWireTransaction(compiledTx);

    // Sign and send via CDP. The CDP SDK's Solana network name matches the
    // WalletChain short name "solana"; the registry has no Solana testnet.
    const result = await cdp.solana.sendTransaction({
      network: "solana",
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
 * Derives the Associated Token Address for a wallet and mint. Standard PDA
 * derivation against the ATA program with seeds
 * [wallet, tokenProgram, mint], where every seed is the 32-byte DECODED
 * public key (base58 strings are never used as seed bytes directly).
 */
async function findAssociatedTokenAddress(
  wallet: Address,
  mint: Address
): Promise<Address> {
  const [derivedAddress] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM_ID),
    seeds: [
      bs58.decode(String(wallet)),
      bs58.decode(SPL_TOKEN_PROGRAM_ID),
      bs58.decode(String(mint)),
    ],
  });
  return derivedAddress;
}
