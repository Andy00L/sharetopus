import "server-only";

import { eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { referral_codes } from "@/db/schema";

/**
 * Generates (or retrieves) a unique referral code for a user.
 *
 * Called when the user opens the referral page, the only place the code is
 * shown, so the code exists before anyone can share it.
 *
 * Idempotent: if a code already exists for this user, returns it.
 * Collision-safe: on unique-violation (duplicate code), retries with
 * a fresh random code up to MAX_ATTEMPTS times before returning failure.
 *
 * Code format: 7 uppercase alphanumeric characters, excluding
 * ambiguous glyphs (0, O, 1, I, L) for readability when shared.
 *
 * Tables: referral_codes (read + insert)
 * Called by: getReferralSummary (referral page)
 */

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
  // Check for existing code first (idempotent path)
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

  // Generate a new code with collision retry
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidateCode = generateRandomCode();
    const { error: insertError } = await runQuery(
      db.insert(referral_codes).values({ user_id: userId, code: candidateCode }),
    );

    if (!insertError) {
      return { success: true, code: candidateCode };
    }

    // Postgres unique violation code: 23505
    const isUniqueViolation = insertError.code === "23505";
    if (!isUniqueViolation) {
      console.error(
        `[ensureReferralCode] Insert failed for ${userId} (attempt ${attempt}):`,
        insertError.message,
      );
      return { success: false, message: "Failed to create referral code" };
    }

    // Unique violation on the code column: retry with a new code.
    // Unique violation on user_id (PK): another request already created one.
    // Either way, re-check for existing code before retrying.
    const { data: raceWinnerRows } = await runQuery(
      db
        .select({ code: referral_codes.code })
        .from(referral_codes)
        .where(eq(referral_codes.user_id, userId))
        .limit(1),
    );

    const raceWinner = raceWinnerRows?.[0];
    if (raceWinner) {
      return { success: true, code: raceWinner.code };
    }

    // Code collision (not user_id conflict) -- retry with a fresh code
    console.warn(
      `[ensureReferralCode] Code collision on attempt ${attempt}, retrying`,
    );
  }

  return { success: false, message: "Exhausted referral code generation attempts" };
}
