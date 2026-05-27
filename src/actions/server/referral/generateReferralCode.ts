import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * Generates (or retrieves) a unique referral code for a user.
 *
 * Called eagerly at signup (from ensureUserExists) and lazily as a
 * fallback from the referral page if the eager call was skipped.
 *
 * Idempotent: if a code already exists for this user, returns it.
 * Collision-safe: on unique-violation (duplicate code), retries with
 * a fresh random code up to MAX_ATTEMPTS times before returning failure.
 *
 * Code format: 7 uppercase alphanumeric characters, excluding
 * ambiguous glyphs (0, O, 1, I, L) for readability when shared.
 *
 * Tables: referral_codes (read + insert)
 * Called by: ensureUserExists, getReferralSummary (lazy fallback)
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
  const { data: existing, error: selectError } = await adminSupabase
    .from("referral_codes")
    .select("code")
    .eq("user_id", userId)
    .maybeSingle();

  if (selectError) {
    console.error(
      `[ensureReferralCode] Failed to check existing code for ${userId}:`,
      selectError.message,
    );
    return { success: false, message: "Failed to check existing referral code" };
  }

  if (existing) {
    return { success: true, code: existing.code };
  }

  // Generate a new code with collision retry
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidateCode = generateRandomCode();
    const { error: insertError } = await adminSupabase
      .from("referral_codes")
      .insert({ user_id: userId, code: candidateCode });

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
    const { data: raceWinner } = await adminSupabase
      .from("referral_codes")
      .select("code")
      .eq("user_id", userId)
      .maybeSingle();

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
