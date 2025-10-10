import { getContentHistoryGroupedByBatch } from "@/actions/server/contentHistoryActions/getContentHistory";
import { auth } from "@clerk/nextjs/server";
import ContentHistoryCard from "./ContentHistoryCard";
import NoBatch from "./EmptyContentHistory";
import NoData from "./noData";

export default async function RenderPosts() {
  const { userId } = await auth();
  const posts = await getContentHistoryGroupedByBatch(userId);

  // Handle errors or missing data
  if (!posts.success || !posts.data) {
    return <NoData />;
  }

  const data = posts.data;
  if (data === null) {
    return <NoData />;
  }

  // Check if we have any batches
  const batchIds = Object.keys(posts.data);
  if (batchIds.length === 0) {
    return <NoBatch />;
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {batchIds.map((batchId) => (
          <ContentHistoryCard key={batchId} items={posts.data![batchId]} />
        ))}
      </div>
    </>
  );
}
