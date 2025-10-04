import { auth } from "@clerk/nextjs/server";

/**
 * Validates that the provided userId matches the authenticated Clerk user
 * @param {string} userId - The user ID to validate
 * @returns {Error} Throws an error if validation fails
 * @returns {Promise<boolean>} Returns true if validation succeeds
 */
export async function authCheck(userId: string | null): Promise<boolean> {
  // Get the authenticated user ID from Clerk
  const { userId: clerkAuth } = await auth();

  // Check if the provided userId exists
  if (!userId) {
    console.error(
      `[authCheck] Authentication failed: User ID was not provided (null)`
    );
    return false;
  }

  // Check if the provided userId matches the authenticated user
  if (userId !== clerkAuth) {
    console.error(
      `[authCheck] Authentication failed: User ID mismatch. Provided: "${userId}", Expected: "${clerkAuth}"`
    );
    return false;
  }

  // If validation passes, return true
  return true;
}
