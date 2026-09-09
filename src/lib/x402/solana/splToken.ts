import "server-only";

/**
 * SPL Token instruction builders shared by every Solana money path
 * (refundSolana.ts sends, the post-now Blink asks the wallet to send).
 * Hand-encoded against the on-chain layouts so no extra program client is
 * needed; @solana/kit compiles the plain instruction objects.
 *
 * Account roles come from the @solana/kit AccountRole enum: READONLY=0,
 * WRITABLE=1, READONLY_SIGNER=2, WRITABLE_SIGNER=3. Token accounts are PDAs
 * and never sign; the owner is the only signer of a transfer.
 *
 * Called by: solana/refundSolana.ts, solanaActions/buildUsdcPaymentTransaction.ts
 * Tables touched: none
 */

import { AccountRole, address, getProgramDerivedAddress } from "@solana/kit";
import type { Address } from "@solana/kit";
import bs58 from "bs58";

/** SPL Token program (constant program id). */
export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Associated Token Account program (constant program id). */
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** System program, required as an account by the ATA create instruction. */
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

/** TransferChecked discriminator. sourceRef: spl-token instruction.rs */
const TRANSFER_CHECKED_INSTRUCTION = 12;

/** CreateIdempotent discriminator. sourceRef: spl-associated-token-account instruction.rs */
const CREATE_ATA_IDEMPOTENT_INSTRUCTION = 1;

/** The plain instruction shape @solana/kit accepts in a transaction message. */
export type SplInstruction = {
  programAddress: Address;
  accounts: { address: Address; role: AccountRole }[];
  data: Uint8Array;
};

/**
 * Derives the Associated Token Address for a wallet and mint. Standard PDA
 * derivation against the ATA program with seeds
 * [wallet, tokenProgram, mint], where every seed is the 32-byte DECODED
 * public key (base58 strings are never used as seed bytes directly).
 */
export async function findAssociatedTokenAddress(
  wallet: Address,
  mint: Address,
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

/**
 * TransferChecked: moves `atomicAmount` of `mint` from the source ATA to the
 * destination ATA, with the mint's decimals checked on-chain.
 * Data layout: [u8 instruction=12, u64 amount little-endian, u8 decimals].
 * Account order: source, mint, destination, authority.
 */
export function buildTransferCheckedInstruction(params: {
  sourceAta: Address;
  mint: Address;
  destinationAta: Address;
  authority: Address;
  atomicAmount: bigint;
  decimals: number;
}): SplInstruction {
  const instructionData = new Uint8Array(10);
  instructionData[0] = TRANSFER_CHECKED_INSTRUCTION;
  new DataView(instructionData.buffer).setBigUint64(1, params.atomicAmount, true);
  instructionData[9] = params.decimals;

  return {
    programAddress: address(SPL_TOKEN_PROGRAM_ID),
    accounts: [
      { address: params.sourceAta, role: AccountRole.WRITABLE },
      { address: params.mint, role: AccountRole.READONLY },
      { address: params.destinationAta, role: AccountRole.WRITABLE },
      { address: params.authority, role: AccountRole.READONLY_SIGNER },
    ],
    data: instructionData,
  };
}

/**
 * CreateIdempotent on the ATA program: creates `owner`'s token account for
 * `mint` when it is missing and succeeds as a no-op when it exists, so a
 * first-ever payment to a recipient cannot fail on a missing account.
 * `payer` funds the rent and must sign.
 * Account order: payer, ata, owner, mint, system program, token program.
 */
export function buildCreateAssociatedTokenAccountIdempotentInstruction(params: {
  payer: Address;
  ata: Address;
  owner: Address;
  mint: Address;
}): SplInstruction {
  return {
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM_ID),
    accounts: [
      { address: params.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: params.ata, role: AccountRole.WRITABLE },
      { address: params.owner, role: AccountRole.READONLY },
      { address: params.mint, role: AccountRole.READONLY },
      { address: address(SYSTEM_PROGRAM_ID), role: AccountRole.READONLY },
      { address: address(SPL_TOKEN_PROGRAM_ID), role: AccountRole.READONLY },
    ],
    data: Uint8Array.of(CREATE_ATA_IDEMPOTENT_INSTRUCTION),
  };
}
