import "server-only";

import { AccountRole, address, getProgramDerivedAddress } from "@solana/kit";
import type { Address } from "@solana/kit";
import bs58 from "bs58";

export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

const TRANSFER_CHECKED_INSTRUCTION = 12;

const CREATE_ATA_IDEMPOTENT_INSTRUCTION = 1;

export type SplInstruction = {
  programAddress: Address;
  accounts: { address: Address; role: AccountRole }[];
  data: Uint8Array;
};

// ATA program seeds: [wallet, token program, mint], each the 32-byte decoded public key.
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

// SPL Token TransferChecked: data [u8 12, u64 amount little-endian, u8 decimals]; accounts source, mint, destination, authority.
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

// ATA program CreateIdempotent: data [u8 1]; accounts payer, ata, owner, mint, system program, token program.
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
