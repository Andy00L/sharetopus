import { Button } from "@/components/ui/button";
import { AlertCircle, Link } from "lucide-react";

export default function NoAccountAvaible() {
  return (
    <div className="text-center p-8 border rounded-lg">
      <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium mb-2">No social accounts connected</h3>
      <p className="text-muted-foreground mb-4">
        You haven&apos;t connected any social media accounts yet.
      </p>
      <Link href="/accounts">
        <Button variant="outline">Connect Accounts</Button>
      </Link>
    </div>
  );
}
