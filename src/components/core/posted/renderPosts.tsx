import { getContentHistory } from "@/actions/server/contentHistoryActions/getContentHistory";
import type { ContentHistory } from "@/lib/types/dbTypes";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import ContentHistoryCard from "./ContentHistoryCard";
import NoData from "./noData";

export default async function RenderPosts() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const result = await getContentHistory(userId, "web");
  if (!result.success || !result.data?.length) return <NoData />;

  const grouped = result.data.reduce<Record<string, ContentHistory[]>>(
    (acc, item) => {
      const key = item.batch_id ?? "no-batch";
      (acc[key] ??= []).push(item);
      return acc;
    },
    {},
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {Object.entries(grouped).map(([batchId, items]) => (
        <ContentHistoryCard key={batchId} items={items} />
      ))}
    </div>
  );
}
