import "server-only";

import { eq } from "drizzle-orm";

import { db, isUniqueViolation, runQuery } from "@/db/client";
import { referral_codes } from "@/db/schema";

const UNAMBIGUOUS_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 7;
const MAX_ATTEMPTS = 5;

function generateRandomCode(): string {
  const chars: string[] = [];
  const randomBytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  for (let index = 0; index < CODE_LENGTH; index++) {
    chars.push(
      UNAMBIGUOUS_ALPHABET[randomBytes[index] % UNAMBIGUOUS_ALPHABET.length],
    );
  }
  return chars.join("");
}

export async function ensureReferralCode(
  userId: string,
): Promise<{ success: true; code: string } | { success: false; message: string }> {
  const { data: existingRows, error: selectError } = await runQuery(
    db
      .select({ code: referral_codes.code })
      .from(referral_codes)
      .where(eq(referral_codes.user_id, userId))
      .limit(1),
  );

  if (selectError) {
    console.error(
      `[ensureReferralCode] Failed to check existing code for ${userId}:`,
      selectError.message,
    );
    return { success: false, message: "Failed to check existing referral code" };
  }

  const existing = existingRows[0];
  if (existing) {
    return { success: true, code: existing.code };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidateCode = generateRandomCode();
    const { error: insertError } = await runQuery(
      db.insert(referral_codes).values({ user_id: userId, code: candidateCode }),
    );

    if (!insertError) {
      return { success: true, code: candidateCode };
    }

    if (!isUniqueViolation(insertError)) {
      console.error(
        `[ensureReferralCode] Insert failed for ${userId} (attempt ${attempt}):`,
        insertError.message,
      );
      return { success: false, message: "Failed to create referral code" };
    }

    const { data: raceWinnerRows, error: raceWinnerError } = await runQuery(
      db
        .select({ code: referral_codes.code })
        .from(referral_codes)
        .where(eq(referral_codes.user_id, userId))
        .limit(1),
    );
    if (raceWinnerError) {
      console.error(
        `[ensureReferralCode] Re-read after a unique violation failed for ${userId}:`,
        raceWinnerError.message,
      );
      return { success: false, message: "Failed to create referral code" };
    }

    const raceWinner = raceWinnerRows[0];
    if (raceWinner) {
      return { success: true, code: raceWinner.code };
    }

    console.warn(
      `[ensureReferralCode] Code collision on attempt ${attempt}, retrying`,
    );
  }

  return { success: false, message: "Exhausted referral code generation attempts" };
}
