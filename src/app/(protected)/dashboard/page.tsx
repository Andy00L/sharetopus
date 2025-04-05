import { currentUser } from "@clerk/nextjs/server";

export default async function Page() {
  const user = await currentUser();
  const UserEmail = user?.primaryEmailAddress?.emailAddress;
  const fullName = user?.fullName;

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div>Contenu</div>
          <span>{UserEmail}</span>
          <span>{fullName}</span>
        </div>
      </div>
    </div>
  );
}
