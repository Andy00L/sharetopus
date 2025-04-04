import { ensureUserExists } from "@/actions/server/supabase/ensureUserExists";
import { ConnectTikTokButton } from "@/components/core/account/ConnectButton";
import { auth, currentUser } from "@clerk/nextjs/server";

export default async function Page() {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();

  const user = await currentUser();
  const UserEmail = user?.primaryEmailAddress?.emailAddress;
  const fullName = user?.fullName;

  // Ensure user exists in our database (creates if doesn't exist)
  ensureUserExists({
    userId,
    UserEmail,
    fullName,
  });
  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div>Contenu</div>
          <ConnectTikTokButton />
        </div>
      </div>
    </div>
  );
}
