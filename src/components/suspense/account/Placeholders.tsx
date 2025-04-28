// components/suspense/Placeholders.tsx
export function ButtonPlaceholder() {
  return <div className="h-9 w-36 bg-muted animate-pulse rounded-md"></div>;
}

export function AccountListPlaceholder() {
  return (
    <div className="h-10 w-full bg-muted/50 rounded-full animate-pulse"></div>
  );
}

export function SectionPlaceholder() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 w-24 bg-muted rounded"></div>
        <div className="h-9 w-36 bg-muted rounded-md"></div>
      </div>
      <div className="h-10 w-full bg-muted/50 rounded-full"></div>
    </div>
  );
}

export function MessagePlaceholder() {
  return (
    <div className="h-40 w-full bg-muted/30 rounded-lg animate-pulse"></div>
  );
}
