import { Users } from "lucide-react";

export default function NoAccountsMessage() {
  return (
    <div className="text-center p-8 border rounded-lg bg-muted/30">
      <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium mb-2">No social accounts connected</h3>
      <p className="text-muted-foreground mb-4">
        Connect your social accounts to manage them here.{" "}
      </p>
    </div>
  );
}
