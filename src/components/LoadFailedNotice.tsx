import { RefreshPageButton } from "@/components/RefreshPageButton";

export function LoadFailedNotice({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <article
      role="alert"
      className="mx-4 mt-6 max-w-md rounded-xl border border-border bg-card p-6 sm:mx-auto"
    >
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      <div className="mt-5">
        <RefreshPageButton />
      </div>
    </article>
  );
}
