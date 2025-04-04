"server only";

import { supabase } from "@/actions/api/supabase";
import { UserData } from "@/actions/types/user/UserData";

export async function ensureUserExists({
  userId,
  UserEmail,
  fullName,
}: {
  readonly UserEmail?: string;
  readonly fullName?: string | null;
  readonly userId: string;
}): Promise<UserData | null> {
  try {
    // Check if user already exists in our database
    const { data: existingUser, error: fetchError } = await supabase
      .from("user")
      .select("*")
      .eq("id", userId)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("Error fetching user (ensureUserExists):", fetchError);
      throw fetchError;
    }

    // If user already exists, return their data
    if (existingUser) {
      return {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        premiumStatus: existingUser.premium_status,
        premiumExpiry: existingUser.premium_expiry
          ? new Date(existingUser.premium_expiry)
          : null,
      };
    }

    // Create a new user record with fallback values if Clerk data is incomplete
    const newUser = {
      id: userId,
      email: UserEmail,
      name: fullName ?? "User",
    };

    // Log the user data being inserted (for debugging)
    console.error("Creating new user with data (ensureUserExists):", newUser);

    const { data: createdUser, error: createError } = await supabase
      .from("user")
      .insert(newUser)
      .select()
      .single();

    if (createError) {
      console.error("Error creating user(ensureUserExists):", createError);
      throw createError;
    }

    return {
      id: createdUser.id,
      email: createdUser.email,
      name: createdUser.name,
      premiumStatus: createdUser.premium_status,
      premiumExpiry: createdUser.premium_expiry
        ? new Date(createdUser.premium_expiry)
        : null,
    };
  } catch (error) {
    console.error("Error in ensureUserExists:", error);
    return null;
  }
}
