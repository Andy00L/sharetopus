import { auth } from "@clerk/nextjs/server";

export async function authCheck(userId: string | null): Promise<boolean> {
  const { userId: clerkAuth } = await auth();

  if (!userId) {
    console.error(
      `[authCheck] Authentication failed: User ID was not provided (null)`
    );
    return false;
  }

  if (userId !== clerkAuth) {
    console.error(
      `[authCheck] Authentication failed: User ID mismatch. Provided: "${userId}", Expected: "${clerkAuth}"`
    );
    return false;
  }

  return true;
}
