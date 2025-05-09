import { auth } from "@clerk/nextjs/server";

/**
 * Validates that the provided userId matches the authenticated Clerk user
 * @param {string} userId - The user ID to validate
 * @throws {Error} Throws an error if validation fails
 * @returns {Promise<boolean>} Returns true if validation succeeds
 */
export async function validateUserAuthorization(userId: string | null) {
  // Get the authenticated user ID from Clerk
  const { userId: clerkAuth } = await auth();

  // Check if the provided userId exists and matches the authenticated user
  if (!userId || userId !== clerkAuth) {
    console.error("User not Auth");
    return false;
  }

  // If validation passes, return true
  return true;
}
