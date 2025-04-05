// actions/server/supabase/ensureUserExists.ts
"server only";

import { supabase } from "@/actions/api/supabase";

export async function ensureUserExists({
  userId,
  UserEmail,
  fullName,
}: {
  readonly userId: string;
  readonly UserEmail?: string;
  readonly fullName?: string | null;
}) {
  try {
    // Vérifier si l'utilisateur existe déjà
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error(
        "Erreur lors de la vérification de l'utilisateur:",
        fetchError
      );
      throw fetchError;
    }

    // Si l'utilisateur existe déjà, mettre à jour ses données si nécessaire
    if (existingUser) {
      if (
        existingUser.email !== UserEmail ||
        existingUser.first_name !== fullName?.split(" ")[0] ||
        existingUser.last_name !== fullName?.split(" ")[1]
      ) {
        const { error: updateError } = await supabase
          .from("users")
          .update({
            email: UserEmail,
            first_name: fullName?.split(" ")[0] ?? existingUser.first_name,
            last_name: fullName?.split(" ")[1] ?? existingUser.last_name,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);

        if (updateError) {
          console.error(
            "Erreur lors de la mise à jour de l'utilisateur:",
            updateError
          );
          throw updateError;
        }
      }
      return existingUser;
    }

    // Créer un nouvel utilisateur si nécessaire
    const [firstName, ...lastNameParts] = (fullName ?? "").split(" ");
    const lastName = lastNameParts.join(" ");

    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        id: userId,
        email: UserEmail,
        first_name: firstName || null,
        last_name: lastName || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error(
        "Erreur lors de la création de l'utilisateur:",
        insertError
      );
      throw insertError;
    }

    return newUser;
  } catch (error) {
    console.error("Erreur dans ensureUserExists:", error);
    throw error;
  }
}
